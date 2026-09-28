# Mainnet deployment record and CLI runbook

Prepared 27 September 2026; deployment verified 28 September 2026. This runbook deploys the contract only. It does not enable mainnet X claims, configure production application secrets, migrate existing fees, or publish the feature. The custom browser console retains its existing mainnet signing block; standard Solana CLI deployment is the selected path.

## Completed deployment

The user supplied the dedicated local signer and funded it with 2.9 SOL. The reviewed mainnet artifact was deployed and independently verified at finalized commitment on 28 September 2026. Deployed bytes exactly match the artifact below. The nominated user wallet remains the upgrade authority. The upload buffer is closed with no remaining balance.

- Actual wallet debit: **2.805912160 SOL**.
- Retained program storage deposit: **2.803027160 SOL**.
- Net network cost across all upload attempts: **0.002885000 SOL**.
- Remaining wallet balance: **0.094087840 SOL**.

The first public-RPC attempt and a one-iteration authenticated-RPC attempt stopped before completing writes. Each was reconciled before resuming the same buffer. The successful attempt used the existing production Helius RPC, zero priority fees, and at most five signing iterations, with a fresh conservative budget check. No new program or buffer identity was created on retry. RPC credentials and private keys were never printed.

Exact program identity, authority, finalized slot, artifact hash, funding baseline and accounting are saved privately in `.local/fee-escrow/mainnet-release-src/deployment-verified.json`. This record is excluded from Git. Do not rerun the initial deployment command: the program is now deployed.

**Application activation is separate and unfinished:** initialize the mainnet verifier/configuration and controls, bind the web client to the mainnet program/domain, then verify a real claim. The staging feature gates remain unchanged. Deployment success does not assert that the production fee-sharing feature is live. Closing the program is controlled by its upgrade authority; preserving active recipients and future fee rights before closure remains an operational responsibility.

## Reviewed build and quote

The isolated build lives in `.local/fee-escrow/mainnet-release-src`. It substitutes the scratch program declaration and claim domain only; shared Rust remains devnet. Its receipt binds current reviewed source, substituted source, exact artifact SHA256, program identity and network. It is local build traceability, not an independent audit or reproducible-build attestation.

- Artifact: `build/oneonly_fee_escrow.so`, **551,440 bytes**.
- SHA256: `43e17fdd453b47d823a7a2291d22a397ca0860ee7fca75159c8e6ac39c9839fd`.
- Claim domain: `oneonly:fee:v2:mainnet-beta`. The artifact contains the intended program identity and mainnet domain, and does not contain the devnet claim domain.
- Program creation key: `program-creation-key.json`; upload buffer creation key: `buffer-creation-key.json`. Both are local mode-0600 creation keys. Never use the unrelated auto-generated key under `build/`.
- Build receipt: `build-receipt.json`. Read-only cost snapshot: `cost-proposal.json`.
- Explicit user-selected CLI signer: `/Users/don/.config/oneonly-deployment/mainnet-wallet.json`. The deployment agent must not read an unrelated/default CLI key, echo this file, or include it in the repository. The user supplies/converts their selected wallet separately; public-key equality must be verified against the nominated authority before any send.

Official RPC `https://api.mainnet.solana.com` returned finalized mainnet genesis `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` and the following quote at 2026-09-27 15:29 UTC:

| Item                            |             SOL |
| ------------------------------- | --------------: |
| Temporary upload-buffer rent    |     2.802153400 |
| Retained ProgramData rent       |     2.802194040 |
| Retained Program rent           |     0.000833120 |
| Retained total rent             | **2.803027160** |
| Estimated base transaction fees |     0.003085000 |
| Estimated total                 | **2.806112160** |
| User's spending limit           | **3.000000000** |

The buffer's lamports fund ProgramData at deployment; do not add its full rent again to the retained total. The fee estimate uses 613 conservative 900-byte writes at 5,000 lamports each and two creation/deployment transactions at 10,000 lamports each, with zero priority price. Standard CLI chunk sizing and confirmation behavior can differ, so fees are an estimate. The proposed program and ProgramData were absent; nominated wallet balance was zero at quote time. Refresh these checks immediately before execution.

## Execution prerequisites

The deployment above is complete. The following documents the original preparation checks, not an instruction to redeploy. Before any future deployment: obtain the scoped deployment approval, confirm funding, verify the nominated public wallet from the explicit signer, compare the artifact with its receipt, check mainnet genesis and both proposed accounts absent, and establish the **3 SOL total spending ceiling**. Do not auto-fund, auto-retry a failed deployment, extend allocation, or change source/artifact after approval. Solana CLI lacks an aggregate lifetime budget flag; use the explicit wallet and bounded attempt count below, inspect balances and transaction outcomes before any further command, and never assume this command alone enforces the ceiling across retries.

The installed CLI is Agave/Solana 3.1.14. It supports explicit payer, program/buffer signers, maximum data length, bounded resign attempts and zero priority price. All wallet/authority options are explicit so the default configured wallet is not selected.

Run only after approval from the repository root:

```sh
solana program deploy \
  .local/fee-escrow/mainnet-release-src/build/oneonly_fee_escrow.so \
  --url https://api.mainnet.solana.com \
  --keypair /Users/don/.config/oneonly-deployment/mainnet-wallet.json \
  --fee-payer /Users/don/.config/oneonly-deployment/mainnet-wallet.json \
  --upgrade-authority /Users/don/.config/oneonly-deployment/mainnet-wallet.json \
  --program-id .local/fee-escrow/mainnet-release-src/program-creation-key.json \
  --buffer .local/fee-escrow/mainnet-release-src/buffer-creation-key.json \
  --max-len 551440 \
  --max-sign-attempts 1 \
  --with-compute-unit-price 0 \
  --use-rpc \
  --no-auto-extend \
  --commitment finalized \
  --output json-compact
```

Do not add `--final`, `--skip-preflight`, or `--skip-feature-verify`. Do not use a randomly generated CLI buffer: the explicit private buffer key permits recovery without the CLI printing a seed phrase. A nonzero exit or timeout means stop and reconcile the existing program/buffer and signatures, not rerun with a fresh identity.

## Finalized verification

After a successful result, read both loader accounts at finalized commitment and independently verify:

1. Program is executable, owned by upgradeable loader v3, and points to the correct ProgramData PDA.
2. ProgramData belongs to the same loader, has exactly the reviewed data allocation, and its upgrade authority equals the nominated wallet.
3. Deployed ELF bytes match the reviewed SHA256. Any allocation padding is zero.
4. Actual wallet debit and recorded fees remain within the 3 SOL ceiling; report retained rent separately from spent network fees.
5. Temporary buffer funds are consumed/refunded as expected; recover any residual buffer only with a separate explicit, balance-checked command. Never close Program or ProgramData as buffer cleanup.

Because the payer and final upgrade authority are now the same nominated wallet, no authority handoff is required. For reference only, the installed CLI supports public-key authority transfer via `set-upgrade-authority --skip-new-upgrade-authority-signer-check`; that option is unnecessary for this plan and must not be run.

[Solana's deployment guide](https://solana.com/docs/programs/deploying) describes CLI deployment and authority inspection. The [official cluster reference](https://solana.com/docs/references/clusters) identifies the public mainnet endpoint. Account sizes and local CLI flags were verified directly rather than inferred from the app's environment configuration.
