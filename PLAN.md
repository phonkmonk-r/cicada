# Rotating Multisig: Plan (v1)

What v1 needs before it goes to mainnet, the decisions behind it and what is done. How the system works today is in `ARCHITECT.md`; optional future work (keeper, EIP-1271 co-signer, private signature collection, v2 RotatingWallet) is in `ROADMAP.md`. Last updated 2026-10-12.

## 1. Status

| Phase | State |
|---|---|
| 1. Spec and threat model | Done |
| 2. RotationGuard contract | Done, pending external audit. Two security reviews fixed (4j-18); deployed on Sepolia at `0xeE3b…D074`. Unit, mainnet fork, SafeL2, fuzz, invariant, gas and PoC suites; mutation-tested (35 mutants that each delete or weaken one check, 34 killed; the survivor is the unreachable v = 0 branch) |
| 3. Generator CLI | Done (`packages/generator`), cross-checked by `contracts/test/GeneratorVector.t.sol`. Ledger mode not yet run on a real device |
| Demo | Done: `contracts/demo/run.sh`, a 2-of-3 Safe rotating on an Anvil mainnet fork |
| 4. Cicada desktop app | Done and tested on Sepolia (milestone log, section 6); v1 musts open (section 2) |
| 6. Audit, then mainnet canary | Not started (section 2) |
| 5, 7, 8 and v2 | Optional, in `ROADMAP.md` |

## 2. v1 scope

v1 ships to mainnet when every must below is done. Shoulds are answered before release or documented as known limitations.

### 2.1 Must

- **4j-20. Migrate an existing Safe** (planned 2026-10-09; v1 must, decided 2026-10-12). The project's original promise is protecting Safes that already hold funds, but Cicada can only create new Safes or join guarded ones; the legacy Safe App that could convert a Safe was removed in 4j-23. Plan: a "Migrate my Safe" path next to Create. The Safe keeps its address and funds; each owner's current address is swapped for the first key of their own key list.
  - Check: Cicada reads owners, threshold, version, modules and guard, and explains plainly why a Safe cannot be migrated as is (not 1.5.0, another guard or module guard, an unknown module). Safes on 1.3.0 or 1.4.1 need upgrading first: find out how (Safe{Wallet}'s upgrade or Safe's migration contracts) and guide or include it.
  - Invite: the starting owner produces a migration invite listing current owners and the target threshold. Each owner opens it in Cicada, links the owner address they sign with today to their profile (a signature from that address proves control, so an owner on another wallet or Ledger account can take part), and Cicada generates their key list and a signed slot package, as in the create flow.
  - Install: once every package is in, Cicada builds the install batch (enable module, set both guards, `initialize` swapping each owner for its slot's first key, stage, set threshold), simulates it and proposes it to the Transaction Service, so current owners sign with their existing wallets. The guard is not active yet, so Safe{Wallet}'s gas settings are fine for this one transaction. Split the batch if it would pass the gas cap (stage fewer keys; each app stages the rest).
  - Progress checklist every owner sees: Safe checked, who has prepared a key list, install proposed, confirmations, executed, each owner joined. The app explains before signing that old owner addresses stop being owners.
  - Test: anvil end to end, migrating a funded 2-of-3 Safe, including an owner whose address is not their seed's first account.
- **Ledger on a real device**: signing in Cicada, the generator's Ledger mode, and whether the Ethereum app accepts the two-level path's hardened fourth level (section 7). Decided 2026-10-12: verified for v1, not hidden.
- **Packaging and code signing** of the desktop app, so users do not run it from source and macOS does not block it.
- **External audit** of the guard before any mainnet value.
- **Mainnet guard deployment**, then a low-value mainnet canary; add the deployment to `addresses.ts`.

### 2.2 Should

- When more owners confirm than the threshold, does Safe{Wallet} include the extra signatures (the guard rejects them)?
- Does Rabby's Safe integration execute with the owner's own pre-validated signature?

Both only matter when someone executes outside Cicada; if unanswered, document them as limitations.

## 3. Threat model

ECDSA over secp256k1 may break before Q-day, in the sense of recovering a private key from a public key fast enough to matter (for example a week on a large GPU cluster). The defense is "bunker mode": keep funds behind keys whose public keys were never revealed, and move to a fresh key as soon as one signs.

- An address is a hash of the public key; a key that never signed exposes only the hash.
- The public key becomes public the first time the key signs anything: a transaction, a Safe confirmation, an off-chain message (EIP-712, Permit, SIWE), or an on-chain `approveHash`.
- Exposure is binary: one signature reveals everything, more reveal nothing more. So rotating on a timer adds nothing; rotation must happen per signature.
- A multisig is the right container: the Safe address and funds never move, only owners change, and an attacker needs a threshold of exposed keys, each broken inside the short window before it rotates out.

Core rule: an owner whose public key has been exposed must stop being an owner as soon as possible, and the system must make that impossible to forget.

## 4. Decisions

Each line is the decision and, briefly, why.

### Contract

- **Merkle root per signer slot, not an on-chain owner queue.** A queue costs about 20k gas per stored address; a root is one write per slot, a 10,000-key tree (14 proof levels) lasts 10,000 signatures, and the tree file can be regenerated from the seed. Rejected alternative kept from the queue stage: rotate exactly the owners who signed, swap rather than remove, one queue per slot, and enforce with a guard so a forgotten swap reverts.
- **Safe 1.5.0, one singleton guard per chain**, acting as transaction guard, module and module guard. The module guard rejects every other module, closing the "modules bypass the guard" hole on-chain.
- **Leaf** `keccak256(keccak256(abi.encode(chainId, safe, slotId, index, owner)))`: the double hash blocks second-preimage tricks (it matches OpenZeppelin's StandardMerkleTree), and binding chain and Safe stops proof reuse elsewhere.
- **Pre-staged next owners**: a per-slot ring buffer of 5 proven next owners, filled by a permissionless, strictly sequential `stage()`. Proofs cannot go in each proposal (the proposer does not know who will sign, and a signed Safe tx cannot change), and supplying them per transaction would force every transaction through our app. Strict sequence stops a griefer from staging the last index and burning the tree; only the Safe may skip (`skipTo`). A bad stager can only waste its own gas.
- **Last signer executes**, with a pre-validated signature (v = 1, r = `msgSender`). Public confirmations for one pending transaction then reveal at most threshold - 1 keys, and the executor's key first appears in the transaction that rotates it. On-chain `approveHash` (v = 1 from anyone else) is rejected, since that owner was exposed earlier.
- **Exactly `threshold * 65` signature bytes**: extra signatures would be public without being rotated. Contract signatures (v = 0) are rejected; the phase 7 co-signer (`ROADMAP.md`) will need that relaxed for a flagged non-rotating owner.
- **Rotate regardless of inner success**: a failed inner call still used the nonce and published the signatures. Signers already removed or force-rotated earlier in the transaction are skipped, and so are staged entries that are already owners (4j-18).
- **Owner set invariant**: after every guarded transaction `getOwners()` equals the slot owners, and all three hooks are still installed. Direct `addOwner`, `removeOwner` and `swapOwner` outside the guard revert; `changeThreshold` is allowed. Delegatecall only to MultiSendCallOnly.
- **Per-root consumed index**: when a root leaves a slot, its first never-used index is recorded, and re-committing that root must start at or above it. Without it, re-committing an old tree brings exposed owners back (found by the invariant suite).
- **No owner-to-slot mapping** (2026-10-08): a signer's slot is found by scanning at most `MAX_SLOTS` = 32 slot IDs. It removed one new storage entry per rotation: the 2-of-3 overhead fell from 65.1k to 43.5k gas per signer locally.
- **Escape hatch**: a transaction that is exactly `setGuard(0)` to the Safe itself (value 0, plain call) skips both hooks, so it works even if the checks are what is broken. `to == safe` matters (any transaction carrying that calldata would otherwise skip rotation; caught by mutation testing). Its signers are burned and must be treated as exposed.
- **Gas and refund rules** (4j-18): `safeTxGas` and `gasPrice` both non-zero, refund only in ETH to the executor. With `gasPrice` 0 a callee that burned gas on-chain made the whole transaction revert, publishing every signature without rotation; a refund to a receiver that rejects ETH did the same. The escape hatch keeps both at zero.
- **One `checkTransaction` per Safe nonce** (transient nonce lock): stops hook replay from inside a batch, which a review showed could bypass the escape path's owner snapshot.
- **Size budget**: Sepolia's repricing puts the guard's deployment near the 2^24 per-transaction gas cap, and mainnet is likely to follow, so any on-chain addition needs a byte budget (`CLAUDE.md`, Sepolia).
- **The guard stays small and makes no external calls beyond the Safe**: the keeper or app funds gas; pulling gas from the Safe inside the hooks was rejected as a way to brick the Safe.

### App

- **A dedicated signing app, not ordinary wallets.** Every signature moves the owner to a new address; wallets are built around a few stable accounts. Pre-loading accounts is a manual switch per signature; deriving on the standard wallet path needs a seed per signer per Safe and would expose future keys through a leaked xpub. Cicada always signs with the right key; the signer never picks an account.
- **One app per signer, from onboarding to daily use** (4j, 2026-10-08). Each signer runs their own copy holding only their own keys; signers share only public data (chain, Transaction Service queue, slot packages). Safe{Wallet} is an optional viewer. Seeds live in an encrypted vault (scrypt + AES-256-GCM, password each launch), with Ledger as the hardware alternative.
- **Account 0 of each seed is the operator/gas account**, never an owner: it pays staging and execution gas, signs slot packages, and was the signer's initial owner in the create flow.
- **Rules engine enforces exposure limits** instead of memory: at most threshold - 1 off-chain confirmations; the last signer executes; refuse on an empty buffer, a non-next nonce or a reverting simulation; recorded exposures count like confirmations. At threshold 1, proposing executes directly.
- **Proposers (Transaction Service delegates) are not used**: tested on Sepolia, a delegate is deleted when the owner who registered it rotates, and registering exposes that owner. Proposing signs as the proposer's own confirmation, at no extra exposure.
- **Just-in-time gas, not a guard change** (4j-4): rotation keys hold no ETH between uses; before executing, the gas account sends the current key the estimated gas plus a sweep, and the remainder is swept back after. Since 4j-22 the executor also attaches the refund's upper bound as value, so a Safe with no ETH can execute.
- **Private, revert-protected RPC on mainnet** (Flashbots Protect): a mined revert publishes a threshold of signatures without rotation. On Sepolia it held executions forever (few connected builders), so Sepolia uses the read RPC.
- **Key path**: `m/44'/60'/{a}'/{b}'/{i}` from `safeKeyPath(chain, Safe, generation)`, derived one address at a time, never by exporting an extended public key (section 7). The derivation domain strings were renamed to `cicada/…` on 2026-10-09, which moved every key; renaming them again would do the same.
- **Message signing is refused** for owner keys: it would expose a key without rotation, and the signature dies when owners rotate. Only the operator account may sign a slot package message.
- **Two transactions to create a Safe** (deploy, then install): tree leaves bind the Safe address, which depends on the initializer.
- **Name**: Cicada, which leaves its shell behind as each signature leaves its exposed key.

### Exposure the guard cannot see

| Leak | Handling |
|---|---|
| Confirmations on the Transaction Service are public before execution | Executor rule keeps one pending transaction below threshold; the rules engine caps confirmations and counts recorded exposures |
| Signed but never executed (replaced or rejected nonce) | Signers burned; `forceRotate` in the next transaction |
| Off-chain messages (EIP-1271, Permit, SIWE, Snapshot) | Burned. Owner keys sign Safe transactions only; Cicada refuses messages |
| An owner key with `nonce > 0` from anything but a rotating execution | Burned; the unused-key check flags it (4j-10) |
| A mined reverted `execTransaction` | All signers burned; prevented by simulation, the gas rules and a revert-protected RPC; recovered by force-rotate |
| An execution sent but never mined | A full threshold exposed and unrotated. Speed up to land it, or force-rotate every signer at the same nonce; detected from the app's signing log (4j-16) |
| Same owner address on another chain | Keys are bound to chain and Safe by the key path (section 7) |

## 5. Findings that changed the design

- Re-committing an old tree brought back exposed owners: fixed with the per-root consumed index (invariant suite).
- `setGuard(0)` calldata to any address skipped rotation until `to == safe` was pinned by a test (mutation testing).
- Rotation cost 65-82k gas per signer locally, not the 40-50k first estimated; dropping the owner-to-slot mapping brought it to 43.5-67.5k.
- Sepolia's October 2026 repricing of contract and state creation: deploying the guard costs about 16M gas against the 16,777,216 cap, a 2-of-3 rotating transfer 652k on the first guard and 430k once the owner-to-slot mapping was gone, a fresh account about 205k gas. Mainnet is likely to follow, hence the size budget.
- A Safe with no ETH could not execute once `gasPrice` was 1 wei, while simulations at gas price 0 passed (4j-22).
- The public Transaction Service rate-limits (429) duplicate reads: reads are shared, cached 3 s, and retried (4j-19).

## 6. Milestone log

Done unless marked. Details of how each works are in `ARCHITECT.md`.

- **4a-4h. Safe App** (legacy, removed in 4j-23): `packages/core`, app shell, dashboard, setup wizard, staging, exposure tracker, executor pre-flight. Signer management later moved into Cicada.
- **4i. Rotation signer**: core Transaction Service client, local SafeTx hashing, action decoding and rules engine; `packages/keys`; local server with token and Host-header checks; React UI; end-to-end tests with three signers; Sepolia run through the real Transaction Service; Electron desktop app over IPC.
- **4j-1. Wallet vault**: encrypted seed import and unlock.
- **4j-2. Join a guarded Safe** from seed, password and Safe address: detects the network, finds the slot, rebuilds and checks the tree.
- **4j-3. Create a Safe**: invite code, slot packages, deploy and install from the creator's gas account. Trust note: the creator alone executes the install, so each signer must check their slot and the threshold after joining, before funds go in.
- **4j-4. Self-staging and just-in-time gas**: the app stages its own slot when two buffer places are free and funds and sweeps the executing key.
- **4j-5. Propose in the app**: transfers and force-rotate, signed as the proposer's confirmation.
- **4j-6. Profiles**: any number of seed or Ledger profiles, one unlocked at a time. Ledger device signing, packaging and code signing are v1 musts (section 2).
- **4j-7. dApp browser**: sandboxed view, injected EIP-1193/EIP-6963 wallet whose account is the Safe; requests become proposals reviewed in the app; dApps may not call the Safe or the guard.
- **4j-8. Name and icon**: Cicada.
- **4j-9. Transaction queue**: queued actions sent as one MultiSendCallOnly proposal, simulated with `eth_simulateV1`; dApp reads run on top of queued calls; dApps that read through their own RPC get the real execution hash and a warning.
- **4j-10. Unused-key check**: keys with a nonce on the Safe's network or mainnet are never installed or staged; Skip used keys proposes `skipTo` plus staging. Off-chain signatures leave no nonce, so the per-Safe key path stays the main protection.
- **4j-11. Per-Safe key path** (one-level), superseded by 4j-13.
- **4j-12. Several Safes per profile**, each with its own session; the gas account is shared.
- **4j-13. Two-level key path and collision alarm** from the guard's `OwnerStaged` and `OwnerRotated` events (section 7).
- **4j-14. Signed slot packages**: EIP-191 signature by the operator address; impostor packages rejected; adding a signer requires confirming the package's signer over a separate channel.
- **4j-15. Renewing a key list** (`setRoot` to the next generation plus staging in one batch, since `setRoot` empties the buffer) **and contract calls** from an ABI or raw data.
- **4j-16. Executions that never land**: signing log and open executions on disk, resumed after restart, Speed up from the same key and nonce, one-button recovery by force-rotating every exposed slot at the lost transaction's nonce.
- **4j-17. Welcome page and loading skeletons.**
- **4j-18. Second security review and scaling to 32 signers**: the gas and refund rules, the nonce lock, skipping staged entries that are already owners, and removing three checks those fixes made redundant (guard 10,547 to 10,212 bytes). Scaling on Sepolia: an N-of-N rotating transfer is at most 39% of the gas cap at 32 signers, but one install fits 15 signers with 5 keys staged each, 29 with 1 and 32 with none, so the create flow stages fewer keys when needed and each app stages the rest. Mainnet fits 32 with 5 each.
- **4j-19. Threshold-1 Safes** execute directly; Transaction Service reads shared, cached and retried.
- **4j-20. Migrate an existing Safe**: open, v1 must (section 2).
- **4j-21. dApp browser compatibility and tabs**: extensible injected wallet (Uniswap), per-site connect (Curve), tabs and popups, saved pages. Checked against Uniswap, Aave, CoW Swap, Lido, 1inch and Curve.
- **4j-22. Safes without ETH could not execute**: found on Sepolia when every execution reverted with GS011; fixed by attaching the refund bound as value. Reverted executions now show why.
- **4j-23. Repository layout** (2026-10-12): Foundry in `contracts/`, generator in `packages/generator`, desktop app in `apps/cicada` (`@cicada/app`; its data folder is unchanged), legacy Safe App removed.
- **4j-24. Reject a transaction** (2026-10-12): Reject on the next transaction proposes a force-rotate of every exposed slot plus the rejecter's own at the same nonce; Safe{Wallet}'s 0/0 rejection is refused by the guard. Later transactions no longer block it, and a recovery's own signers count as covered. Tested in rules, on anvil (including a lost race), over the HTTP API, in the desktop e2e and in Foundry.

## 7. Key derivation and collisions

A seed can sign for several Safes from computers that never talk to each other. If two Safes of one seed shared a key, a key exposed in Safe A could later be rotated into Safe B as a "fresh" owner. Different seeds cannot collide in practice (a 160-bit address collision).

| Layout | Key `i` at | Numbers | Status |
|---|---|---|---|
| Ranged | `m/44'/60'/{base + i}'/0/0` | `base = 100,000 + keccak(chain, Safe) mod 10^9` | First Sepolia Safes |
| One-level | `m/44'/60'/{a}'/0/{i}` | `a = 100,000 + h mod S`, `S = 2^31 - 2^20 - 100,000` | Briefly, 2026-10-08 |
| Two-level | `m/44'/60'/{a}'/{b}'/{i}` | `h = keccak(chain, Safe, "cicada/two-level")`, `a = 100,000 + h mod S`, `b = (h >> 128) mod 2^31` | Current |

Every device computes `a` and `b` from chain and Safe alone, so no coordination is needed. Joining tries all three layouts, and renewal uses later generations of the two-level path.

**Against ordinary wallets and the earlier layouts: impossible by construction.** Different child indexes under one BIP-32 parent give different keys (short of an HMAC-SHA512 collision). Ordinary wallets and the two earlier layouts use non-hardened `0` at the fourth level; the two-level layout uses a hardened `b'` (at least 2^31) there, so it can never meet them.

**Between two-level Safes: a bound.** With keccak as a random function, `(a, b)` is uniform over `N = S × 2^31 ≈ 4.61 × 10^18` pairs, so for one seed in `n` Safes, `P(any collision) ≤ n(n-1) / (2N)`: about 1 in 4.6 × 10^18 for 2 Safes, 1.1 × 10^-15 for 100, 1.1 × 10^-11 for 10,000. A billion seeds with 10 Safes each expect about 10^-8 colliding seeds in total. The earlier layouts were far weaker (ranged: about 1 in 50,000 per pair; one-level: about 1 in 2 billion).

**Defenses on top**: the collision alarm refuses keys the guard already staged or rotated for another Safe (on-chain, so across devices; blind to a slot's very first key, best effort if an RPC refuses log searches); the nonce check refuses used keys; slot packages start at the first run of six unused keys.

**Cost**: every layout has five levels and each costs the same to derive, so a Ledger takes roughly 30-100 ms per address either way. Extended public keys are never exported, since that would put a slot's future public keys in one place.
