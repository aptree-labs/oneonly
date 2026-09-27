# External-wallet deployment preparation

This tooling plans a fresh upgradeable-loader-v3 deployment and provides a local **devnet-only** approval console. It does not implement upgrades or initialize the escrow's governance/configuration. Mainnet plans can be inspected, but every signing entry point rejects mainnet. No readiness flag bypasses this restriction.

The nominated external wallet pays transaction fees, controls the upload buffer, receives buffer refunds, and becomes the deployed program's upgrade authority. Its private key stays in the Jupiter extension. Local keys are only the program creation key and a temporary buffer creation key; neither grants upgrade authority after deployment.

## Prepare and rehearse

Use a reviewed ELF built for the exact program creation key. Without a rehearsal receipt, the CLI permits read-only planning only; fixed-identity signing remains blocked until a verified build-receipt path is supplied. The CLI rejects a creation key unless it matches both the SDK program identity and checked-in Rust `declare_id!`, and checks that those identity bytes occur in the artifact. This is a consistency guard, not proof of reproducible compilation; reviewed build provenance must still establish the exact artifact. The generic loader planner checks ELF magic, length and SHA256. Keep program creation keys and the state directory private (0600 and 0700 respectively).

Run from the repository with its installed dependencies:

```sh
node --import ./packages/db/node_modules/tsx/dist/loader.mjs packages/fee-escrow/scripts/prepare-wallet-deployment.ts \
  --network devnet \
  --artifact /absolute/path/to/reviewed-program.so \
  --program-key /absolute/path/to/program-creation-key.json \
  --authority-plan /absolute/path/to/public-authority-plan.json \
  --max-total-lamports 2000000000 \
  --fee-ceiling-lamports 20000 \
  --out-dir /absolute/path/to/private-rehearsal-directory \
  --rehearsal-receipt /absolute/path/to/build-receipt.json \
  --console
```

The example budget is an example limit, not a deployment quote. Actual read-only rent and fee planning determines whether it suffices. The authority plan uses the existing `intendedUpgradeAndClosureAuthority` public field. Never pass the user's wallet keypair as `--program-key`; this is rejected. The manifest exports only public fields through an explicit allowlist.

The console acquires an exclusive private state-directory lock before reading its journal. A second process is rejected. Orderly shutdown removes only its own lock; a crash leaves a stale lock requiring explicit journal/chain reconciliation before manual removal. The console binds to `127.0.0.1` on an ephemeral port. Open the private URL saved in `console-access.json`; its random capability is never printed. It has the same local file protections as the journal. The fragment is removed from browser history after loading. Host, loopback source, Origin and capability checks protect API requests; scripts and styles are local and CSP rejects external resources.

**Current usability limitation:** the reviewed 551,112-byte artifact requires 613 writes at 900 bytes per chunk, plus create/deploy. This console requests one wallet approval per transaction (at least 615), so it is an engineering rehearsal tool, not yet a fast production deployment experience. Safe batching or a narrowly authorized upload signer is still required and must preserve the same cost and authority checks.

Connect the nominated Jupiter wallet, review the network/build hash/addresses/budgets, and approve each step explicitly. Wallet Standard supplies `standard:connect` and `solana:signTransaction`; the browser requests signing only. The server verifies the exact reviewed message, all signatures and fee payer before broadcast. The extension must expose those features and a devnet-capable account. **Actual Jupiter extension approval still requires a human devnet rehearsal; mocked tests do not establish provider compatibility.**

## Resume, cost limits and refunds

Every signed transaction's exact bytes, signature, expiry and maximum funding/fee reservation are fsynced to the private journal **before** broadcast. A timeout retains that transaction and blocks new approvals. Rebroadcast sends the same signed bytes. A network genesis check precedes reconciliation; finalized account inspection is required before another step is prepared. Matching uploaded chunks are skipped.

Reservations are deliberately conservative: every signed attempt keeps its original funding-plus-fee reservation even after failure, expiry or refund. Previous reservations plus the remaining rent and maximum-fee allowance must fit `maxTotalLamports`. Buffer recovery also consumes this total cap and the per-transaction fee ceiling. This is a tooling approval cap, not an on-chain wallet-wide spending limit; other wallet activity is outside its scope. The initial estimate includes both buffer and ProgramData rent, so it overestimates peak/net funding where the loader reuses or refunds buffer rent.

Finalized receipts separately record actual transaction fees and net account funding (negative for refunded funding). Receipt fees must be nonnegative integers and within the reviewed ceiling; actual debit must not exceed its reservation. Missing receipts stop progress. An expired signature absent from RPC history is marked unresolved for fee accounting and stops new approvals; do not delete/reset its journal to retry. Investigate with archival RPC history and review the state before any manual recovery. This conservative halt avoids treating missing history as proof of zero cost.

Explicit buffer recovery validates the exact manifested loader Buffer and its wallet authority, then refunds only to that wallet. It cannot close Program or ProgramData. If the total budget is exhausted, the current console stops; it does not silently grant a new allowance. An independently reviewed recovery transaction/plan is required. Keep the original journal for reconciliation. Closing the browser or server never cancels an already signed transaction.

The temporary buffer creation secret is saved locally with mode 0600; the wallet remains its authority. Losing that creation key after initialization does not change its authority, but this console currently expects both local creation keys on restart. Do not place secret-key files or the private console capability in exported manifests, logs, commits or support messages.

## Planner API and transaction accounts

`createDeploymentManifest` binds network genesis, exact artifact digest and sizes, public program/buffer/wallet identities, total cap, per-transaction cap and bounded priority price. `inspectDeployment` and `deploymentCosts` perform read-only finalized checks. `prepareNextDeployment` returns an unsigned-by-wallet legacy transaction, step, expiry, exact message SHA256 and quoted fee. It adds only local program/buffer creation signatures when needed. `assertDeploymentWalletSignature` rejects any message change, including wallet-added instructions or fee changes. `prepareBufferRecovery` creates a separate explicit recovery approval.

| Step          | Loader instruction / account metas                                                                                                                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create buffer | System create plus InitializeBuffer atomically. Buffer writable; wallet authority readonly. Creation key signs System create.                                                                                                                                        |
| Write         | Buffer writable; wallet authority readonly signer. Byte offset and bounded 900-byte chunks are checked against finalized buffer content.                                                                                                                             |
| Deploy        | System create Program plus DeployWithMaxDataLen atomically. Wallet payer writable signer; ProgramData writable; Program writable; Buffer writable; Rent, Clock, System readonly; wallet upgrade authority readonly signer. Program creation key signs System create. |
| Recover       | Close Buffer writable; refund wallet writable; same wallet authority readonly signer.                                                                                                                                                                                |

Completion requires an executable Program pointing to its expected ProgramData PDA, exact reviewed ELF bytes and zero padding, correct loader owner and external wallet upgrade authority. It does not establish application configuration readiness or authorize mainnet launch.

## Verification and release gate

Automated tests cover public manifests, packet limits, account metas, chunk resume, artifact/authority/network rejection, signature-message tampering, cost limits, HTTP guards, durable-before-send timeout recovery and receipt-accounting stops. RPC responses and test wallets are local fixtures; tests never broadcast to Solana. Browser tests exercise the actual local UI on desktop and mobile with a generated Wallet Standard test wallet: review/cancel/sign, durable journal, unknown-outcome duplicate prevention, and overflow checks. They do not establish actual Jupiter extension compatibility.

For a fresh devnet rehearsal, build an isolated artifact first:

```sh
node --import ./packages/db/node_modules/tsx/dist/loader.mjs packages/fee-escrow/scripts/build-deployment-rehearsal.ts \
  --out-dir .local/fee-escrow/rehearsal-src
```

This copies the reviewed Cargo manifests/lock and Rust sources, creates a private local program creation key once, and changes only `declare_id!` in the scratch source. It builds offline and records the source SHA256 before substitution, substituted source SHA256, git revision, exact ELF SHA256, devnet claim domain and program identity. Shared source is never edited. Supply this scratch artifact/key to preparation together with `--rehearsal-receipt /absolute/path/to/build-receipt.json`. The CLI validates the receipt against the current reviewed source and bytes; a source change requires a rebuild. This receipt provides local build traceability, not reproducible-build or audited-artifact proof: the compiler/toolchain and inherited build environment are not pinned. Fixed-identity console signing is disabled; use this devnet rehearsal receipt path. Rehearsal artifacts are forbidden on mainnet. An existing deployed program with different bytes remains rejected: no upgrade path is implied.

Before mainnet, complete a human Jupiter devnet rehearsal, verify the deployed artifact/authority independently, test application initialization and recovery, review security and operational ownership, and explicitly approve a separately implemented mainnet signing path. This implementation intentionally has no mainnet switch.

Loader layout and account ordering follow [Solana program deployment documentation](https://solana.com/docs/core/programs/program-deployment), the [official upgradeable loader implementation](https://github.com/solana-labs/solana/blob/master/sdk/program/src/bpf_loader_upgradeable.rs), and the [official instruction enum](https://github.com/solana-labs/solana/blob/master/sdk/program/src/loader_upgradeable_instruction.rs).
