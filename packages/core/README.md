# @rotating-msig/core

Shared logic for the rotating Safe multisig, with no keys and no Node-only code. It is everything that has to agree with the `RotationGuard` contract or with Safe, written once so the desktop app, the key package and the tree generator cannot drift apart.

## What it does

- **Trees** (`tree.ts`, `base.ts`): the tree file format, leaves (`keccak256(keccak256(abi.encode(chainId, safe, slotId, index, owner)))`, identical to `RotationGuard.leaf`), Merkle roots and proofs, key paths and per-Safe account ranges.
- **Contract data** (`abi/`, `addresses.ts`): ABIs for the guard, Safe and MultiSendCallOnly, and the canonical Safe 1.5.0 and guard deployments per chain.
- **Calldata** (`calls.ts`, `proposals.ts`, `setup.ts`, `create.ts`): builds guard and Safe calls, proposals (transfers, force-rotate, signer and threshold changes, renewals, batches), the install transaction and the two-step creation of a new guarded Safe.
- **Safe transactions** (`safetx.ts`): the `SafeTx` struct, EIP-712 typed data, the locally computed safeTxHash, and gas and refund settings the guard accepts.
- **Reading state** (`state.ts`, `decode.ts`, `errors.ts`): reads a Safe and its slots in one call, decodes what a transaction does in plain language, and names guard and Safe revert reasons.
- **Rules engine** (`rules.ts`): decides whether a signer may confirm or execute, enforcing the rules the design depends on (the last signer executes, at most threshold - 1 off-chain confirmations, nonce order, staged keys, exposure limits, recoveries and rejections).
- **Transaction Service client** (`txservice.ts`): reads pending transactions (rechecking every hash and signature), proposes and confirms, with caching, rate-limit retries and timeouts.

## Why it is needed

The guard only accepts transactions shaped exactly right (signature length, gas fields, leaf encoding), and a mistake publishes signatures without rotating anyone. Keeping that knowledge here means Cicada (`apps/cicada`), `@rotating-msig/keys` and `@rotating-msig/generator` all build and check transactions the same way, and the tests catch drift from the contract.

## Development

```sh
npm run build -w @rotating-msig/core
npm test -w @rotating-msig/core   # needs contracts/out from `forge build` and anvil
npm run abi -w @rotating-msig/core   # after a contract change; test/abi.test.ts fails on drift
```
