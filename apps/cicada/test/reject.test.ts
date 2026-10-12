import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Address, Hex } from "viem";
import { foundry } from "viem/chains";

import { plainSafeTx, TxService } from "@cicada/core";
import { seedSource } from "@cicada/keys";

import { SignerSession, type Execution } from "../src/session.js";
import { memoryStore } from "../src/store.js";
import { hasAnvil, hasArtifacts, SIGNER_SEEDS, startChain, startFakeTxService, type Chain, type FakeTxService } from "./fixture.js";

const skip = !hasAnvil ? "anvil not installed" : !hasArtifacts ? "run `forge build` first" : false;
const RECIPIENT: Address = "0x000000000000000000000000000000000000beef";

describe("rejecting a pending transaction", { skip, timeout: 120_000 }, () => {
  let chain: Chain;
  let service: FakeTxService;
  let sessions: SignerSession[];

  const fresh = () =>
    SIGNER_SEEDS.map(
      (seed, slot) =>
        new SignerSession({
          publicClient: chain.client,
          chain: foundry,
          executionRpcUrl: chain.rpc,
          txService: new TxService(foundry.id, { baseUrl: service.baseUrl, pendingCacheMs: 0 }),
          source: seedSource(seed),
          tree: chain.trees[slot]!,
          safe: chain.safe,
          multiSendCallOnly: chain.multiSend,
          store: memoryStore(),
        }),
    );

  async function executeAndWait(signer: SignerSession, hash: Hex): Promise<Execution> {
    await signer.execute(hash);
    for (let i = 0; i < 100; i++) {
      const record = await signer.execution(hash);
      if (record.status !== "pending" && record.status !== "preparing") return record;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("execution stayed pending");
  }

  const nonce = async () => BigInt((await sessions[0]!.status()).nonce);
  const transfer = (at: bigint) => service.propose(plainSafeTx({ to: RECIPIENT, value: 1n, data: "0x", operation: 0, nonce: at }));
  const owners = async () => (await sessions[0]!.status()).signers.map((signer) => signer.owner);

  before(async () => {
    chain = await startChain(8564);
    service = await startFakeTxService(chain.safe, foundry.id);
    await chain.client.request({ method: "anvil_setBalance" as never, params: [chain.safe, "0xde0b6b3a7640000"] as never });
  });

  after(async () => {
    await service?.stop();
    chain?.stop();
  });

  it("replaces a confirmed transaction at its nonce, so it can never run, and rotates its confirmer", async () => {
    sessions = fresh();
    const [zero, one, two] = sessions as [SignerSession, SignerSession, SignerSession];
    const at = await nonce();
    const unwanted = transfer(at);
    await zero.confirm(unwanted);
    const before = await owners();
    const paid = await chain.client.getBalance({ address: RECIPIENT });

    const preview = await two.reject(unwanted, true);
    assert.equal(preview.proposed, false);
    assert.deepEqual(preview.slotIds, [0, 2], "the confirmer's exposed slot and the rejecter's own");
    assert.equal(preview.nonce, at.toString(), "proposed at the rejected transaction's nonce");
    assert.match(preview.actions[0]!.summary, /Rotate slot\(s\) 0, 2/);
    const rejection = await two.reject(unwanted);
    assert.equal(rejection.proposed, true);

    const queue = await one.queue();
    assert.deepEqual(queue.map((item) => item.nonce), [at.toString(), at.toString()]);
    const replacing = queue.find((item) => item.safeTxHash === rejection.safeTxHash)!;
    assert.equal(replacing.verdict.action, "execute", replacing.verdict.blockers.join());
    assert.match(replacing.verdict.warnings.join(), /only one of them can ever execute/);

    const done = await executeAndWait(one, rejection.safeTxHash as Hex);
    assert.equal(done.status, "success", done.message);
    assert.deepEqual(done.rotated?.map((change) => change.slotId).sort(), [0, 1, 2]);
    const after = await owners();
    for (let slot = 0; slot < 3; slot++) assert.notEqual(after[slot], before[slot], `slot ${slot} has a fresh key`);

    assert.equal(await nonce(), at + 1n);
    assert.equal(await chain.client.getBalance({ address: RECIPIENT }), paid, "the rejected transfer never ran");
    assert.deepEqual(await one.queue(), []);
    await assert.rejects(one.execute(unwanted), /not pending/);
    await assert.rejects(zero.confirm(unwanted), /not pending/);
    for (const signer of sessions) assert.equal((await signer.status()).exposure, undefined, "nothing is left exposed");
  });

  it("rejects only the next transaction, and does not wait for later ones in the queue", async () => {
    sessions = fresh();
    const [zero, one, two] = sessions as [SignerSession, SignerSession, SignerSession];
    const at = await nonce();
    const unwanted = transfer(at);
    const later = transfer(at + 1n);
    await zero.confirm(unwanted);

    await assert.rejects(two.reject(later), new RegExp(`only the next transaction \\(#${at}\\) can be rejected`));
    const rejection = await two.reject(unwanted);
    const done = await executeAndWait(one, rejection.safeTxHash as Hex);
    assert.equal(done.status, "success", done.message);

    const [next] = await zero.queue();
    assert.equal(next?.safeTxHash, later, "the later transaction is next now");
    assert.equal(next?.verdict.action, "confirm", "and signers can carry on with it");
    service.drop(later);
  });

  it("if the rejected transaction wins the race, flags the rejecter's key and replaces it", async () => {
    sessions = fresh();
    const [zero, one, two] = sessions as [SignerSession, SignerSession, SignerSession];
    const at = await nonce();
    const raced = transfer(at);
    await zero.confirm(raced);
    const rejection = await two.reject(raced);

    const done = await executeAndWait(one, raced);
    assert.equal(done.status, "success", done.message);
    assert.deepEqual(done.rotated?.map((change) => change.slotId).sort(), [0, 1]);

    const { exposure } = await two.status();
    assert.deepEqual(exposure?.slotIds, [2], "the rejection's signature is public, and it can no longer run");
    assert.equal(exposure?.safeTxHash.toLowerCase(), rejection.safeTxHash.toLowerCase());
    const recovery = await two.recover();
    const fixed = await executeAndWait(zero, recovery.safeTxHash as Hex);
    assert.equal(fixed.status, "success", fixed.message);
    assert.equal((await two.status()).exposure, undefined);
  });
});
