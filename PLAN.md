# Rotating Multisig: Plan

Design decisions, what is done, and what is next. How the system works today is in `ARCHITECT.md`; this file keeps the reasons and the open work. Last updated 2026-10-12.

## 1. Status

| Phase | State |
|---|---|
| 1. Spec and threat model | Done |
| 2. RotationGuard contract | Done, pending external audit. Two security reviews fixed (4j-18); deployed on Sepolia at `0xeE3b…D074`. Unit, mainnet fork, SafeL2, fuzz, invariant, gas and PoC suites; mutation-tested |
| 3. Generator CLI | Done (`packages/generator`), cross-checked by `contracts/test/GeneratorVector.t.sol`. Ledger mode not yet run on a real device |
| Demo | Done: `contracts/demo/run.sh`, a 2-of-3 Safe rotating on an Anvil mainnet fork |
| 4. Cicada desktop app | v1 done and tested on Sepolia (milestone log, section 5) |
| 5. Keeper | Superseded for signers who run Cicada: each app refills its own slot and pays its own gas (4j-4). Only needed for signers who never open the app |
| 6. Audit, then mainnet canary | Not started |
| 7. Hash-based EIP-1271 co-signer | Not started |
| 8. Private signature collection (option B) | Not started |
| v2. RotatingWallet | Planned, not scheduled (section 6) |

### Open work

- **4j-20. Migrate an existing Safe** (planned 2026-10-09). The project's original promise is protecting Safes that already hold funds, but Cicada can only create new Safes or join guarded ones; the legacy Safe App that could convert a Safe was removed in 4j-23. Plan: a "Migrate my Safe" path next to Create. The Safe keeps its address and funds; each owner's current address is swapped for the first key of their own key list.
  - Check: Cicada reads owners, threshold, version, modules and guard, and explains plainly why a Safe cannot be migrated as is (not 1.5.0, another guard or module guard, an unknown module). Safes on 1.3.0 or 1.4.1 need upgrading first: find out how (Safe{Wallet}'s upgrade or Safe's migration contracts) and guide or include it.
  - Invite: the starting owner produces a migration invite listing current owners and the target threshold. Each owner opens it in Cicada, links the owner address they sign with today to their profile (a signature from that address proves control, so an owner on another wallet or Ledger account can take part), and Cicada generates their key list and a signed slot package, as in the create flow.
  - Install: once every package is in, Cicada builds the install batch (enable module, set both guards, `initialize` swapping each owner for its slot's first key, stage, set threshold), simulates it and proposes it to the Transaction Service, so current owners sign with their existing wallets. The guard is not active yet, so Safe{Wallet}'s gas settings are fine for this one transaction. Split the batch if it would pass the gas cap (stage fewer keys; each app stages the rest).
  - Progress checklist every owner sees: Safe checked, who has prepared a key list, install proposed, confirmations, executed, each owner joined. The app explains before signing that old owner addresses stop being owners.
  - Test: anvil end to end, migrating a funded 2-of-3 Safe, including an owner whose address is not their seed's first account.
- **Ledger on a real device**: signing, the generator's Ledger mode, and whether the Ethereum app accepts the two-level path's hardened fourth level (section 7).
- **Packaging and code signing** of the desktop app.
- **Open questions**: when more owners confirm than the threshold, does Safe{Wallet} include the extra signatures (the guard rejects them)? Does Rabby's Safe integration execute with the owner's own pre-validated signature?
- **dApps**: WalletConnect for dApps in the user's own browser; an owner-key mode for Safe{Wallet}.
- **Assurance**: optional Echidna/Medusa campaign; external audit before mainnet value, then a low-value mainnet canary; a mainnet guard deployment.
- **Size budget**: Sepolia's repricing puts the guard's deployment near the 2^24 per-transaction gas cap, and mainnet is likely to follow. Any on-chain addition (including the phase 7 co-signer) needs a byte budget (`CLAUDE.md`, Sepolia).

## 2. Threat model

ECDSA over secp256k1 may break before Q-day, in the sense of recovering a private key from a public key fast enough to matter (for example a week on a large GPU cluster). The defense is "bunker mode": keep funds behind keys whose public keys were never revealed, and move to a fresh key as soon as one signs.

- An address is a hash of the public key; a key that never signed exposes only the hash.
- The public key becomes public the first time the key signs anything: a transaction, a Safe confirmation, an off-chain message (EIP-712, Permit, SIWE), or an on-chain `approveHash`.
- Exposure is binary: one signature reveals everything, more reveal nothing more. So rotating on a timer adds nothing; rotation must happen per signature.
- A multisig is the right container: the Safe address and funds never move, only owners change, and an attacker needs a threshold of exposed keys, each broken inside the short window before it rotates out.

Core rule: an owner whose public key has been exposed must stop being an owner as soon as possible, and the system must make that impossible to forget.

## 3. Decisions

Each line is the decision and, briefly, why.

### Contract

- **Merkle root per signer slot, not an on-chain owner queue.** A queue costs about 20k gas per stored address; a root is one write per slot, a 10,000-key tree (14 proof levels) lasts 10,000 signatures, and the tree file can be regenerated from the seed. Rejected alternative kept from the queue stage: rotate exactly the owners who signed, swap rather than remove, one queue per slot, and enforce with a guard so a forgotten swap reverts.
- **Safe 1.5.0, one singleton guard per chain**, acting as transaction guard, module and module guard. The module guard rejects every other module, closing the "modules bypass the guard" hole on-chain.
- **Leaf** `keccak256(keccak256(abi.encode(chainId, safe, slotId, index, owner)))`: the double hash blocks second-preimage tricks (it matches OpenZeppelin's StandardMerkleTree), and binding chain and Safe stops proof reuse elsewhere.
- **Pre-staged next owners**: a per-slot ring buffer of 5 proven next owners, filled by a permissionless, strictly sequential `stage()`. Proofs cannot go in each proposal (the proposer does not know who will sign, and a signed Safe tx cannot change), and supplying them per transaction would force every transaction through our app. Strict sequence stops a griefer from staging the last index and burning the tree; only the Safe may skip (`skipTo`). A bad stager can only waste its own gas.
- **Last signer executes**, with a pre-validated signature (v = 1, r = `msgSender`). Public confirmations for one pending transaction then reveal at most threshold - 1 keys, and the executor's key first appears in the transaction that rotates it. On-chain `approveHash` (v = 1 from anyone else) is rejected, since that owner was exposed earlier.
- **Exactly `threshold * 65` signature bytes**: extra signatures would be public without being rotated. Contract signatures (v = 0) are rejected; phase 7 will need that relaxed for a flagged non-rotating owner.
- **Rotate regardless of inner success**: a failed inner call still used the nonce and published the signatures. Signers already removed or force-rotated earlier in the transaction are skipped, and so are staged entries that are already owners (4j-18).
- **Owner set invariant**: after every guarded transaction `getOwners()` equals the slot owners, and all three hooks are still installed. Direct `addOwner`, `removeOwner` and `swapOwner` outside the guard revert; `changeThreshold` is allowed. Delegatecall only to MultiSendCallOnly.
- **Per-root consumed index**: when a root leaves a slot, its first never-used index is recorded, and re-committing that root must start at or above it. Without it, re-committing an old tree brings exposed owners back (found by the invariant suite).
- **No owner-to-slot mapping** (2026-10-08): a signer's slot is found by scanning at most `MAX_SLOTS` = 32 slot IDs. It removed one new storage entry per rotation: the 2-of-3 overhead fell from 65.1k to 43.5k gas per signer locally.
- **Escape hatch**: a transaction that is exactly `setGuard(0)` to the Safe itself (value 0, plain call) skips both hooks, so it works even if the checks are what is broken. `to == safe` matters (any transaction carrying that calldata would otherwise skip rotation; caught by mutation testing). Its signers are burned and must be treated as exposed.
- **Gas and refund rules** (4j-18): `safeTxGas` and `gasPrice` both non-zero, refund only in ETH to the executor. With `gasPrice` 0 a callee that burned gas on-chain made the whole transaction revert, publishing every signature without rotation; a refund to a receiver that rejects ETH did the same. The escape hatch keeps both at zero.
- **One `checkTransaction` per Safe nonce** (transient nonce lock): stops hook replay from inside a batch, which a review showed could bypass the escape path's owner snapshot.
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

## 4. Findings that changed the design

- Re-committing an old tree brought back exposed owners: fixed with the per-root consumed index (invariant suite).
- `setGuard(0)` calldata to any address skipped rotation until `to == safe` was pinned by a test (mutation testing).
- Rotation cost 65-82k gas per signer locally, not the 40-50k first estimated; dropping the owner-to-slot mapping brought it to 43.5-67.5k.
- Sepolia's October 2026 repricing of contract and state creation: deploying the guard costs about 16M gas against the 16,777,216 cap, a 2-of-3 rotating transfer 652k on the first guard and 430k once the owner-to-slot mapping was gone, a fresh account about 205k gas. Mainnet is likely to follow, hence the size budget.
- A Safe with no ETH could not execute once `gasPrice` was 1 wei, while simulations at gas price 0 passed (4j-22).
- The public Transaction Service rate-limits (429) duplicate reads: reads are shared, cached 3 s, and retried (4j-19).

## 5. Milestone log

Done unless marked. Details of how each works are in `ARCHITECT.md`.

- **4a-4h. Safe App** (legacy, removed in 4j-23): `packages/core`, app shell, dashboard, setup wizard, staging, exposure tracker, executor pre-flight. Signer management later moved into Cicada.
- **4i. Rotation signer**: core Transaction Service client, local SafeTx hashing, action decoding and rules engine; `packages/keys`; local server with token and Host-header checks; React UI; end-to-end tests with three signers; Sepolia run through the real Transaction Service; Electron desktop app over IPC.
- **4j-1. Wallet vault**: encrypted seed import and unlock.
- **4j-2. Join a guarded Safe** from seed, password and Safe address: detects the network, finds the slot, rebuilds and checks the tree.
- **4j-3. Create a Safe**: invite code, slot packages, deploy and install from the creator's gas account. Trust note: the creator alone executes the install, so each signer must check their slot and the threshold after joining, before funds go in.
- **4j-4. Self-staging and just-in-time gas**: the app stages its own slot when two buffer places are free and funds and sweeps the executing key.
- **4j-5. Propose in the app**: transfers and force-rotate, signed as the proposer's confirmation.
- **4j-6. Profiles**: any number of seed or Ledger profiles, one unlocked at a time. Ledger device signing, packaging and code signing are open.
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
- **4j-20. Migrate an existing Safe**: open (section 1).
- **4j-21. dApp browser compatibility and tabs**: extensible injected wallet (Uniswap), per-site connect (Curve), tabs and popups, saved pages. Checked against Uniswap, Aave, CoW Swap, Lido, 1inch and Curve.
- **4j-22. Safes without ETH could not execute**: found on Sepolia when every execution reverted with GS011; fixed by attaching the refund bound as value. Reverted executions now show why.
- **4j-23. Repository layout** (2026-10-12): Foundry in `contracts/`, generator in `packages/generator`, desktop app in `apps/cicada` (`@rotating-msig/cicada`; its data folder is unchanged), legacy Safe App removed.

## 6. v2: RotatingWallet (planned, not scheduled)

Planned 2026-10-08. v1 (Safe 1.5.0 plus RotationGuard) stays the production path until v2 is built, tested, audited and has run as a mainnet canary.

### 6.1 Goal

Our own multisig in which a signer key is used exactly once, and the call that uses it also replaces it. No off-chain confirmations wait anywhere, so a key is never exposed while it is still an owner. v1 needs the threshold - 1 rule, the last-signer-executes rule, exact signature lengths, nonce checks, staging, Merkle proofs, the Transaction Service, and gas funding with sweeps; v2 needs none of them.

### 6.2 Decisions

- Standalone wallet, not a Safe module; the module design (6.11) is the fallback if leaving Safe's audited vault and ecosystem costs too much.
- Approvals are on-chain: an EIP-712 signature by the slot's current owner, verified in the same call that rotates the slot.
- Approvals are relayed by a per-app gas account, so owner keys never hold ETH or become on-chain accounts.
- The next owner is committed one step ahead (6.4), not by a Merkle tree; no tree file exists.
- No message signing (EIP-1271) at first (6.12).
- Immutable implementation, one ERC-1167 minimal proxy per wallet, created through our factory with CREATE2.

### 6.3 Threat model recap

The adversary can derive a private key from any exposed public key, possibly in flight. So a key may sign only in a call that also rotates it away; the replacement must be fixed before it signs; and anything that lands a signed approval without rotating (revert, drop) must be prevented or recoverable.

### 6.4 Next-owner commitment

Each slot stores `owner` and `nextCommitment = keccak256(abi.encode(wallet, chainId, slotId, index + 1, nextOwner))`. An approval by the owner at `index` reveals `nextOwner` (which must match) and supplies the commitment for `index + 2`; the contract rotates in the same call.

A front-runner who derives the key in flight must still reveal the committed next owner. They can only plant a wrong commitment for the step after, which freezes the slot (reset by the others with `resetSlot`); they cannot take it, and their approval is one vote at most. Compared with v1: no tree, no proofs, one storage write per rotation. If review prefers the stronger guarantee, a slot can commit to a Merkle root of its key sequence instead.

### 6.5 Contract

State per wallet: slots (`owner`, `index`, `nextCommitment`), `threshold`, `slotCount`, proposals (calls hash, deadline, approval bitmap by slot ID, status), a sequential proposal ID.

- `propose(calls, deadline, approval) → id`: only a signer; counts as their approval and rotates them. Calls stored as a hash, full calls in an event.
- `approve(id, approval)`: checks signature, index and commitment, records the slot's bit, rotates.
- At threshold, executes through a self-call whose failure is caught: a reverting payload marks the proposal failed but never undoes rotation. `execute(id)` retries.
- `revoke(id, approval)`: a key use, so it rotates.
- Self-administration only through the wallet's own proposals: `addSlot`, `removeSlot`, `changeThreshold`, `resetSlot` (frozen, lost or leaked slot).
- Receives ETH, ERC-721, ERC-1155; ERC-165.

Approval payload (EIP-712, domain = wallet and chain): `Approve(uint256 proposalId, bytes32 callsHash, uint256 slotId, uint32 index, address nextOwner, bytes32 nextNextCommitment)`, and `Revoke` likewise. Binding `index` makes every signature single-use.

Rules: one approval per slot per proposal; approvals recorded by slot ID so they survive rotation; proposals immutable and expiring; CALL only, no delegatecall; admin only from the wallet itself.

Creation: `factory.create(salt, slots, threshold)` deploys and initializes at a CREATE2 address derived from creator and salt, in one transaction (v1 needs two). Initial slots are each signer's index-0 address and index-1 commitment.

### 6.6 App

- Keys derived by index per wallet as in v1; to approve, derive `i` to sign, `i+1` to reveal, `i+2` to commit.
- Gas account submits proposals and approvals through a private RPC; any signer's gas account can relay anyone's approval.
- Sign only immediately before submitting, never store signatures, simulate first; after a drop, resubmit the same signature, never a fresh one from the same key.
- Queue from the wallet's events; no Transaction Service.
- Setup: each signer sends an index-0 address and index-1 commitment; the creator creates the wallet in one transaction.
- Ledger: approvals are EIP-712; the call list needs an ERC-7730 clear-signing descriptor.

### 6.7 Gas (to measure before committing)

Expected 50-80k per approval on mainnet, plus event data for proposals and the calls on the final approval, against v1's ~430-650k rotating 2-of-3 transfer on repriced Sepolia plus staging and funding. Owner keys never become accounts, so repriced account creation never applies. Measure on a mainnet fork and Sepolia for 1-of-1, 2-of-3 and 3-of-5.

### 6.8 Caveats

- Signed but not rotated (revert, out of gas, drop): simulate, private relay, payload failure cannot revert rotation, resubmit the same signature, `resetSlot` last.
- Front-running: at worst a frozen slot and one stray vote.
- Concurrency: a second approval by the same slot in one block fails its index check, harmlessly; the app serializes per slot.
- Relayer liveness: anyone can relay.
- Ecosystem: no Safe{Wallet}, Transaction Service or Safe modules; the audit covers the whole wallet and factory; no message signing until EIP-1271 is decided.

### 6.9 Testing

Unit, invariant, fuzz and mutation tests. Invariants: every executed proposal had threshold distinct slot approvals; a slot owner changes exactly when it approves, revokes or proposes; no owner repeats in a slot's history; revealed next owners match commitments; payload reverts never undo rotation; admin only by the wallet.

### 6.10 Migration from v1

Create the v2 wallet with the same signers on fresh keys, move assets with ordinary v1 transfers, point the app at it. The Safe stays as an empty guarded vault or is retired.

### 6.11 Fallback: rotating approvals as a Safe module

The same approval and commitment logic as a Safe module: the Safe keeps funds and address, its owners become unusable placeholders, the guard blocks `execTransaction`, and the module executes through `execTransactionFromModule`. Keeps the audited vault and Safe{Wallet} as a viewer, at Safe's gas overhead and a harder migration.

### 6.12 Open questions

- EIP-1271: an on-chain, rotating approval per message, or keep refusing.
- Commitment or Merkle root per slot.
- Auto-execute on the final approval, or always a separate `execute`.
- A separate gas seed or the seed's first account.
- Optional spending limits or timelocks.

### 6.13 Milestones

v2-1 specification and invariants; v2-2 contract, factory and clone with tests; v2-3 gas against v1, go or no-go; v2-4 app; v2-5 Sepolia; v2-6 audit; v2-7 migration tooling and mainnet canary.

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
