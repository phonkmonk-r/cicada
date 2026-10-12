# contracts

The Foundry project for `RotationGuard`, the on-chain half of the rotating Safe multisig. Run `forge` from this folder.

## What it does

`src/RotationGuard.sol` is one contract per chain that any Safe 1.5.0 can install as its transaction guard, module and module guard. On every Safe transaction it:

- requires exactly `threshold * 65` signature bytes, with the executor signing through a pre-validated signature (v = 1), and refuses on-chain approvals, contract signatures and zero gas settings;
- records who signed, and right after the call replaces each signer's owner address with the next one from that slot's pre-committed key list, proven against the slot's Merkle root;
- refuses other modules and any change to owners, guards or modules that would bypass it, except the escape hatch (`setGuard(0)`).

Admin calls made by the Safe itself manage slots: `forceRotate`, `skipTo`, `setRoot`, `addSlot`, `removeSlot`, `reinitialize`. Anyone may `stage` the next addresses of a slot, since each is checked against the root.

## Why it is needed

Rotation only protects the Safe if it cannot be skipped. The guard makes every signature lead to a rotation in the same transaction, so no public key that has signed stays an owner. The desktop app and packages build transactions this contract accepts; it is the one part that enforces the rules instead of following them.

## Layout

- `src/`: the guard and its interface.
- `test/`: unit, SafeL2, fuzz, invariant, gas, mainnet fork and audit PoC tests; `GeneratorVector.t.sol` checks the TypeScript tree code against the contract.
- `script/`: `DeployGuard.s.sol` and the local demo script; `demo/run.sh` runs the demo on anvil.
- `deployments/`: deployed addresses per network.
- `lib/`: forge-std, Safe and OpenZeppelin as git submodules.

## Commands

```sh
forge build
forge test                # the fork suite needs MAINNET_RPC_URL, otherwise it skips
```

The TypeScript tests read `contracts/out`, so run `forge build` before `npm test`. Do not run `forge fmt`: the Solidity uses prettier-style wrapping. On Sepolia, deploy the guard with `cast send --create <bytecode> --gas-limit 16777216`: deployment costs about 16M gas, and `forge script` exceeds Sepolia's per-transaction cap of 16,777,216.
