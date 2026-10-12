# @rotating-msig/keys

Key handling for rotation trees, for Node only. It turns a seed phrase or a Ledger into the addresses of a signer's key list and into the account that signs with the slot's current key. Private keys and the mnemonic never leave it.

## What it does

- **Key sources** (`source.ts`, `seed.ts`, `ledger.ts`): one `AddressSource` interface over a BIP-39 seed or a Ledger device, for deriving addresses and signing. The seed's first account (`m/44'/60'/0'/0/0`) is the operator account that pays for gas; it is never an owner.
- **Key paths**: the per-Safe two-level path `m/44'/60'/{a}'/{b}'/{i}` and the older ranged layout, so Safes made with earlier versions still work.
- **Finding your slot** (`discover.ts`): given only a Safe address and a seed, finds which slot is yours by checking each slot's current owner against your keys in every known layout and key generation. This is how joining a Safe works without a tree file.
- **Current owner** (`owner.ts`): from a tree file and the Safe's state, derives the key for the slot's current index and checks it really is the owner on-chain before anything is signed.
- **Terminal prompt** (`prompt.ts`): reads a secret without echoing it, and refuses to run without a terminal.

## Why it is needed

Every owner key is used once and then replaced, so a signer needs the right key out of up to 10,000 for every signature, and it must come from the same derivation the tree was built with. Keeping this in one package means Cicada (`apps/cicada`) and the tree generator (`@rotating-msig/generator`) derive identical addresses, and `@rotating-msig/core` stays free of secrets and Node-only code.

## Development

```sh
npm run build -w @rotating-msig/keys
npm test -w @rotating-msig/keys
```
