# Creator fee escrow — devnet preview

This program locks a DBC pool's creator authority to an allocation PDA and distributes collected creator fees using immutable shares assigned to hashed numeric X IDs. It does not alter Meteora trading, platform fees, or liquidity principal. The verifier is trusted to attest X ownership; Solana cannot verify X posts itself.

## Supported paths

- Atomic allocation initialization and DBC creator transfer, before graduation.
- 1–8 unique recipients, positive basis points totaling 10,000.
- Permissionless collection of actual DBC creator fees or DAMM position fees into separate per-mint cumulative ledgers.
- Claims require the claimant wallet's signature and a fresh verifier-signed authorization checked by the Ed25519 precompile. Domain, program, allocation, mint, X ID, wallet, destination, cumulative limit, binding version, nonce and expiry are signed.
- A nonce is consumed once. Authorization lifetime is at most 15 minutes. First successful claim permanently binds that X ID to its wallet in this preview.
- Each entitlement is `floor(totalCollected × shareBps / 10000) − alreadyPaid`; splitting claims cannot manufacture rounding gains. Mint units are never mixed.
- SPL and Token2022 with metadata extensions are supported. Transfer-fee, transfer-hook and other mint extensions are rejected.
- SOL proceeds remain wrapped SOL in the claimant's own associated token account. No escrow SOL unwrap or arbitrary CPI exists.

## Important limits

This is unaudited preview code. Mainnet is not configured or deployed. Wallet recovery, beneficiary rebinding, verifier rotation and receipt-account rent reclamation are deliberately not implemented. The program upgrade authority remains a trusted authority until a reviewed deployment policy is chosen.

DAMM collection requires an actual one-token position NFT owned by the allocation PDA. Meteora verifies the position, mints and vaults. A same-pair position voluntarily transferred to that PDA can also contribute fees to the same recipients; the program does not limit contributions exclusively to the original migrated position. No instruction withdraws liquidity or transfers the position NFT.

An allocation must be selected when launching a new pool. Existing graduated tokens cannot be opted in through this instruction. Launch packet size depends on token metadata and number of recipients: eight recipients plus a first buy can exceed Solana's 1,232-byte packet limit. The application must measure the final transaction and request fewer recipients or no initial buy.

## Validation

From the repository root:

```sh
cargo test --manifest-path packages/fee-escrow/Cargo.toml --offline
node --import ./packages/db/node_modules/tsx/dist/loader.mjs packages/fee-escrow/scripts/devnet.ts --prepare
pnpm test:fee-escrow
```

`--prepare` downloads public devnet Meteora program binaries into ignored `target/`, compiles the escrow, then runs its tests. No signed transactions are sent. Public account fixtures in `tests/fixtures` are decoded using the installed official SDK coders. LiteSVM tests execute the real compiled escrow, SPL/Token2022 programs, and actual devnet DBC/DAMM binaries. They cover authority transfer, collection idempotency and destination restrictions, principal conservation, cumulative claims, replay, expiry, wallet binding and altered signatures. Those fixtures are separate from the live devnet lifecycle. A complete live Token2022 → DBC → graduation → DAMM collection/claim run also passed on 2026-09-26; public receipts are recorded in `tests/fixtures/devnet-lifecycle.json`.

Measured transactions including signatures and both compute-budget instructions: claim 1,186 bytes; DBC collection 767; DAMM collection 833. The launch-wire test reports several recipient/first-buy combinations.

## Devnet deployment and live lifecycle

Read-only status is the default:

```sh
node --import ./packages/db/node_modules/tsx/dist/loader.mjs packages/fee-escrow/scripts/devnet.ts --check
```

A designated test-only deployer is mandatory for signed operations:

```sh
FEE_ESCROW_DEVNET_DEPLOYER=/absolute/path/to/devnet-test-keypair.json \
  node --import ./packages/db/node_modules/tsx/dist/loader.mjs packages/fee-escrow/scripts/devnet.ts --deploy
FEE_ESCROW_DEVNET_DEPLOYER=/absolute/path/to/devnet-test-keypair.json \
  node --import ./packages/db/node_modules/tsx/dist/loader.mjs packages/fee-escrow/scripts/lifecycle.ts --execute
```

The deploy runner pins the public devnet endpoint and verifies genesis, program keypair and upgrade authority. It builds/tests before deploying. The verifier and deployment buffer keys stay in ignored `.local/fee-escrow/` with restricted file permissions. Never upload them. It refuses to replace a different initialized verifier.

The lifecycle runner creates an isolated 0.2-SOL-graduation Token2022 configuration, launches with two fee recipients, buys, collects and claims, graduates, trades on DAMM, collects again and verifies the second cumulative claim. It persists pending signed transactions before sending and rebroadcasts identical bytes. On restart it checks their receipts before building any new transaction, and only treats an absent transaction as expired after finalized block height passes its validity limit. It saves expected claim accounting before submission and verifies actual transaction token-balance deltas, nonce receipts and cumulative paid state on resume; missing evidence prevents a successful result. It writes public receipts to `.local/fee-escrow/lifecycle.json` and resumes from confirmed steps. Fixture attestations intentionally bypass the X API; X-post ownership integration requires its own staging test. It does not change platform environment variables, production configuration or databases.
