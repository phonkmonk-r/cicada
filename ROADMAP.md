# Rotating Multisig: Roadmap

Optional work after v1. None of it is needed for v1 to be safe on mainnet; v1's scope and decisions are in `PLAN.md`. Last updated 2026-10-12.

## 1. Optional additions to v1

- **Keeper service** (phase 5). A small service on a non-owner account that refills each slot's staging buffer from its tree file and tops up gas. Cicada already does this for its own slot (4j-4), so a keeper only helps signers who never open the app. Trust: a compromised keeper can waste its own ETH or stop staging, never inject owners or skip indexes, since staging is permissionless, proven and strictly sequential.
- **WalletConnect** for dApps in the user's own browser; today the built-in dApp browser covers dApps.
- **Owner-key mode for Safe{Wallet}**, so a signer could use Safe{Wallet} with Cicada's current key; today Cicada replaces Safe{Wallet} for these Safes.
- **Coverage-guided fuzzing** (Echidna or Medusa) on top of the Foundry fuzz and invariant suites.

## 2. Hash-based EIP-1271 co-signer (phase 7)

A second, non-ECDSA owner (Winternitz, XMSS or SPHINCS+) required on every transaction, so breaking ECDSA alone gets an attacker nothing. It is the long-term way out of bunker mode: owners that do not rely on ECDSA need no rotation. The co-signer is its own contract; the guard needs its contract-signature (v = 0) rule relaxed for a flagged non-rotating owner, within the guard's byte budget (`PLAN.md`, decisions).

## 3. Private signature collection (phase 8, option B)

Collect confirmations privately between signers' apps instead of through the public Transaction Service, which removes the window in which threshold - 1 confirmations sit public before execution. The rules engine already keeps that exposure below the threshold, so this is hardening, not a fix.

## 4. Other directions

- Optional spending limits or timelocks for large transfers (also open for v2, 5.12).

## 5. v2: RotatingWallet (planned, not scheduled)

Planned 2026-10-08. v1 (Safe 1.5.0 plus RotationGuard) stays the production path until v2 is built, tested, audited and has run as a mainnet canary.

### 5.1 Goal

Our own multisig in which a signer key is used exactly once, and the call that uses it also replaces it. No off-chain confirmations wait anywhere, so a key is never exposed while it is still an owner. v1 needs the threshold - 1 rule, the last-signer-executes rule, exact signature lengths, nonce checks, staging, Merkle proofs, the Transaction Service, and gas funding with sweeps; v2 needs none of them.

### 5.2 Decisions

- Standalone wallet, not a Safe module; the module design (5.11) is the fallback if leaving Safe's audited vault and ecosystem costs too much.
- Approvals are on-chain: an EIP-712 signature by the slot's current owner, verified in the same call that rotates the slot.
- Approvals are relayed by a per-app gas account, so owner keys never hold ETH or become on-chain accounts.
- The next owner is committed one step ahead (5.4), not by a Merkle tree; no tree file exists.
- No message signing (EIP-1271) at first (5.12).
- Immutable implementation, one ERC-1167 minimal proxy per wallet, created through our factory with CREATE2.

### 5.3 Threat model recap

The adversary can derive a private key from any exposed public key, possibly in flight. So a key may sign only in a call that also rotates it away; the replacement must be fixed before it signs; and anything that lands a signed approval without rotating (revert, drop) must be prevented or recoverable.

### 5.4 Next-owner commitment

Each slot stores `owner` and `nextCommitment = keccak256(abi.encode(wallet, chainId, slotId, index + 1, nextOwner))`. An approval by the owner at `index` reveals `nextOwner` (which must match) and supplies the commitment for `index + 2`; the contract rotates in the same call.

A front-runner who derives the key in flight must still reveal the committed next owner. They can only plant a wrong commitment for the step after, which freezes the slot (reset by the others with `resetSlot`); they cannot take it, and their approval is one vote at most. Compared with v1: no tree, no proofs, one storage write per rotation. If review prefers the stronger guarantee, a slot can commit to a Merkle root of its key sequence instead.

### 5.5 Contract

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

### 5.6 App

- Keys derived by index per wallet as in v1; to approve, derive `i` to sign, `i+1` to reveal, `i+2` to commit.
- Gas account submits proposals and approvals through a private RPC; any signer's gas account can relay anyone's approval.
- Sign only immediately before submitting, never store signatures, simulate first; after a drop, resubmit the same signature, never a fresh one from the same key.
- Queue from the wallet's events; no Transaction Service.
- Setup: each signer sends an index-0 address and index-1 commitment; the creator creates the wallet in one transaction.
- Ledger: approvals are EIP-712; the call list needs an ERC-7730 clear-signing descriptor.

### 5.7 Gas (to measure before committing)

Expected 50-80k per approval on mainnet, plus event data for proposals and the calls on the final approval, against v1's ~430-650k rotating 2-of-3 transfer on repriced Sepolia plus staging and funding. Owner keys never become accounts, so repriced account creation never applies. Measure on a mainnet fork and Sepolia for 1-of-1, 2-of-3 and 3-of-5.

### 5.8 Caveats

- Signed but not rotated (revert, out of gas, drop): simulate, private relay, payload failure cannot revert rotation, resubmit the same signature, `resetSlot` last.
- Front-running: at worst a frozen slot and one stray vote.
- Concurrency: a second approval by the same slot in one block fails its index check, harmlessly; the app serializes per slot.
- Relayer liveness: anyone can relay.
- Ecosystem: no Safe{Wallet}, Transaction Service or Safe modules; the audit covers the whole wallet and factory; no message signing until EIP-1271 is decided.

### 5.9 Testing

Unit, invariant, fuzz and mutation tests. Invariants: every executed proposal had threshold distinct slot approvals; a slot owner changes exactly when it approves, revokes or proposes; no owner repeats in a slot's history; revealed next owners match commitments; payload reverts never undo rotation; admin only by the wallet.

### 5.10 Migration from v1

Create the v2 wallet with the same signers on fresh keys, move assets with ordinary v1 transfers, point the app at it. The Safe stays as an empty guarded vault or is retired.

### 5.11 Fallback: rotating approvals as a Safe module

The same approval and commitment logic as a Safe module: the Safe keeps funds and address, its owners become unusable placeholders, the guard blocks `execTransaction`, and the module executes through `execTransactionFromModule`. Keeps the audited vault and Safe{Wallet} as a viewer, at Safe's gas overhead and a harder migration.

### 5.12 Open questions

- EIP-1271: an on-chain, rotating approval per message, or keep refusing.
- Commitment or Merkle root per slot.
- Auto-execute on the final approval, or always a separate `execute`.
- A separate gas seed or the seed's first account.
- Optional spending limits or timelocks.

### 5.13 Milestones

v2-1 specification and invariants; v2-2 contract, factory and clone with tests; v2-3 gas against v1, go or no-go; v2-4 app; v2-5 Sepolia; v2-6 audit; v2-7 migration tooling and mainnet canary.
