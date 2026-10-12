import { concatHex, getAddress, hexToNumber, isAddressEqual, numberToHex, recoverAddress, recoverMessageAddress, size, sliceHex, type Address, type Hex } from "viem";

import { SEPOLIA_CHAIN_ID } from "./addresses.js";
import { safeTxHash, type SafeTx } from "./safetx.js";

const NETWORK_SHORT_NAMES: Record<number, string> = { 1: "eth", [SEPOLIA_CHAIN_ID]: "sep" };

const LOCAL_TX_SERVICES: Record<number, string> = {};

/** Points a development chain at a local Transaction Service (a test double); real chains use Safe's service. */
export function registerTxService(chainId: number, baseUrl: string): void {
  if (NETWORK_SHORT_NAMES[chainId]) throw new Error(`chain ${chainId} uses Safe's Transaction Service`);
  LOCAL_TX_SERVICES[chainId] = baseUrl;
}

/** Base URL of the Safe Transaction Service for a chain (the per-network domains now redirect here). */
export function txServiceUrl(chainId: number): string {
  const local = LOCAL_TX_SERVICES[chainId];
  if (local) return local;
  const name = NETWORK_SHORT_NAMES[chainId];
  if (!name) throw new Error(`no Safe Transaction Service known for chain ${chainId}`);
  return `https://api.safe.global/tx-service/${name}`;
}

export type SignatureType = "EOA" | "ETH_SIGN" | "APPROVED_HASH" | "CONTRACT_SIGNATURE";

export interface Confirmation {
  owner: Address;
  signature: Hex;
  signatureType: SignatureType;
}

export interface PendingTx {
  safeTxHash: Hex;
  tx: SafeTx;
  confirmations: Confirmation[];
  proposer?: Address;
  submissionDate?: string;
}

export interface TxServiceOptions {
  baseUrl?: string;
  apiKey?: string;
  fetch?: typeof fetch;
  /** How long a pending-transactions answer is reused, in milliseconds (default 3,000; 0 turns the cache off). */
  pendingCacheMs?: number;
}

interface ServiceTx {
  safe: string;
  to: string;
  value: string;
  data: string | null;
  operation: number;
  safeTxGas: string | number;
  baseGas: string | number;
  gasPrice: string | number;
  gasToken: string | null;
  refundReceiver: string | null;
  nonce: string | number;
  safeTxHash: string;
  proposer?: string | null;
  submissionDate?: string;
  confirmations?: { owner: string; signature: string; signatureType: SignatureType }[];
}

/** How long a pending-transactions answer is reused; the app refreshes every 10 s and asks from several places at once. */
const DEFAULT_PENDING_CACHE_MS = 3_000;
/** Attempts for a request the service rate-limits (429), waiting `Retry-After` or a growing delay between them. */
const RATE_LIMIT_ATTEMPTS = 4;
/** How long one request may take before it is abandoned, so a stalled service never freezes refreshes or actions. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Whether an ECDSA or eth_sign confirmation was really made by its owner over `hash`, decoded the way Safe's
 * `checkNSignatures` does (eth_sign: v > 30, over the prefixed hash, with v - 4). Other kinds are not checked here.
 */
async function signedBy(hash: Hex, confirmation: Confirmation): Promise<boolean> {
  if (confirmation.signatureType !== "EOA" && confirmation.signatureType !== "ETH_SIGN") return true;
  try {
    if (size(confirmation.signature) !== 65) return false;
    const v = hexToNumber(sliceHex(confirmation.signature, 64));
    const signer =
      v > 30
        ? await recoverMessageAddress({ message: { raw: hash }, signature: concatHex([sliceHex(confirmation.signature, 0, 64), numberToHex(v - 4, { size: 1 })]) })
        : await recoverAddress({ hash, signature: confirmation.signature });
    return isAddressEqual(signer, confirmation.owner);
  } catch {
    return false;
  }
}

/**
 * Minimal client for the Safe Transaction Service. Every transaction's hash is recomputed locally on read, and a
 * confirmation whose signature was not made by its listed owner over that hash is dropped. Pending
 * transactions are fetched once for concurrent callers and reused for a few seconds (cleared by this client's own
 * proposals and confirmations), and rate-limited requests are retried, since the public API allows only a few
 * requests per second without an API key.
 */
export class TxService {
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pendingCache = new Map<string, { at: number; result: Promise<PendingTx[]> }>();
  private readonly pendingCacheMs: number;

  constructor(
    readonly chainId: number,
    options: TxServiceOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? txServiceUrl(chainId);
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.pendingCacheMs = options.pendingCacheMs ?? DEFAULT_PENDING_CACHE_MS;
  }

  /**
   * Unexecuted transactions from `fromNonce` upwards, oldest first. `fresh` skips the few-second cache: actions that
   * sign or send (confirm, execute, propose) must see confirmations given a moment ago; displays need not.
   */
  async pending(safe: Address, fromNonce: bigint, options: { fresh?: boolean } = {}): Promise<PendingTx[]> {
    const key = `${getAddress(safe)}:${fromNonce}`;
    const cached = this.pendingCache.get(key);
    if (!options.fresh && cached && Date.now() - cached.at < this.pendingCacheMs) return cached.result;
    const result = this.fetchPending(safe, fromNonce);
    this.pendingCache.set(key, { at: Date.now(), result });
    result.catch(() => {
      if (this.pendingCache.get(key)?.result === result) this.pendingCache.delete(key);
    });
    return result;
  }

  private async fetchPending(safe: Address, fromNonce: bigint): Promise<PendingTx[]> {
    const url = `${this.baseUrl}/api/v1/safes/${getAddress(safe)}/multisig-transactions/?executed=false&nonce__gte=${fromNonce}&ordering=nonce&limit=50`;
    const body = (await this.request(url)) as { results: ServiceTx[] };
    return Promise.all(body.results.map((raw) => this.parse(safe, raw)));
  }

  /**
   * Proposes a new transaction. `sender` must be a current owner and `signature` that owner's signature over the
   * transaction's hash, which the service records as their confirmation.
   */
  async propose(safe: Address, tx: SafeTx, sender: Address, signature: Hex, origin = "rotation-signer"): Promise<Hex> {
    const hash = safeTxHash(this.chainId, safe, tx);
    await this.request(`${this.baseUrl}/api/v1/safes/${getAddress(safe)}/multisig-transactions/`, {
      method: "POST",
      body: JSON.stringify({
        to: tx.to,
        value: tx.value.toString(),
        data: tx.data === "0x" ? null : tx.data,
        operation: tx.operation,
        safeTxGas: tx.safeTxGas.toString(),
        baseGas: tx.baseGas.toString(),
        gasPrice: tx.gasPrice.toString(),
        gasToken: tx.gasToken === "0x0000000000000000000000000000000000000000" ? null : tx.gasToken,
        refundReceiver: tx.refundReceiver === "0x0000000000000000000000000000000000000000" ? null : tx.refundReceiver,
        nonce: tx.nonce.toString(),
        contractTransactionHash: hash,
        sender: getAddress(sender),
        signature,
        origin,
      }),
    });
    this.pendingCache.clear();
    return hash;
  }

  /** Adds an owner's confirmation (a 65-byte signature over the safeTxHash). */
  async confirm(hash: Hex, signature: Hex): Promise<void> {
    await this.request(`${this.baseUrl}/api/v1/multisig-transactions/${hash}/confirmations/`, {
      method: "POST",
      body: JSON.stringify({ signature }),
    });
    this.pendingCache.clear();
  }

  private async parse(safe: Address, raw: ServiceTx): Promise<PendingTx> {
    const tx: SafeTx = {
      to: getAddress(raw.to),
      value: BigInt(raw.value),
      data: (raw.data ?? "0x") as Hex,
      operation: raw.operation === 1 ? 1 : 0,
      safeTxGas: BigInt(raw.safeTxGas),
      baseGas: BigInt(raw.baseGas),
      gasPrice: BigInt(raw.gasPrice),
      gasToken: getAddress(raw.gasToken ?? "0x0000000000000000000000000000000000000000"),
      refundReceiver: getAddress(raw.refundReceiver ?? "0x0000000000000000000000000000000000000000"),
      nonce: BigInt(raw.nonce),
    };
    const hash = safeTxHash(this.chainId, safe, tx);
    if (hash.toLowerCase() !== raw.safeTxHash.toLowerCase()) {
      throw new Error(`Transaction Service returned nonce ${tx.nonce} with hash ${raw.safeTxHash}, but its fields hash to ${hash}`);
    }
    const listed: Confirmation[] = (raw.confirmations ?? []).map((c) => ({ owner: getAddress(c.owner), signature: c.signature as Hex, signatureType: c.signatureType }));
    const genuine = await Promise.all(listed.map((c) => signedBy(hash, c)));
    return {
      safeTxHash: hash,
      tx,
      confirmations: listed.filter((_, i) => genuine[i]),
      proposer: raw.proposer ? getAddress(raw.proposer) : undefined,
      submissionDate: raw.submissionDate,
    };
  }

  private async request(url: string, init: RequestInit = {}): Promise<unknown> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.body) headers["content-type"] = "application/json";
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (error) {
        if ((error as Error).name === "TimeoutError") throw new Error(`Transaction Service did not answer within ${REQUEST_TIMEOUT_MS / 1000} s`);
        throw error;
      }
      const text = await response.text();
      // A 429 is rejected before the service does anything, so retrying a POST cannot record it twice.
      if (response.status === 429 && attempt < RATE_LIMIT_ATTEMPTS) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await new Promise((resolve) => setTimeout(resolve, retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1)));
        continue;
      }
      if (!response.ok) throw new Error(`Transaction Service ${response.status}: ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : undefined;
    }
  }
}
