import { formatUnits } from "viem";

export function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function eth(wei: string, digits = 4): string {
  const value = Number(BigInt(wei)) / 1e18;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: digits })} ETH`;
}

const EXPLORERS: Record<number, string> = { 1: "https://etherscan.io", 11155111: "https://sepolia.etherscan.io" };

export function explorer(chainId: number, kind: "tx" | "address", value: string): string | undefined {
  const base = EXPLORERS[chainId];
  return base ? `${base}/${kind}/${value}` : undefined;
}

const SAFE_APP_PREFIXES: Record<number, string> = { 1: "eth", 11155111: "sep" };

/**
 * The transaction's page in Safe{Wallet} (signers, confirmations, decoded calls), or undefined on chains it does not
 * serve. A transaction executed at threshold 1 never went to the Transaction Service, so it has a page only once executed.
 */
export function safeAppTx(chainId: number, safe: string, safeTxHash: string): string | undefined {
  const prefix = SAFE_APP_PREFIXES[chainId];
  return prefix ? `https://app.safe.global/transactions/tx?safe=${prefix}:${safe}&id=multisig_${safe}_${safeTxHash}` : undefined;
}

/** A balance change with its sign, e.g. "−100 MOCK" or "+0.5 ETH". */
export function signedAmount(delta: string, decimals: number, symbol: string): string {
  const value = BigInt(delta);
  const amount = formatUnits(value < 0n ? -value : value, decimals);
  return `${value < 0n ? "−" : "+"}${amount} ${symbol}`;
}

/** Approvals at or above this are shown as unlimited. */
export const UNLIMITED_APPROVAL = 2n ** 255n;
