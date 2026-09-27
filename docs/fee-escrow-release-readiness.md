# Creator-fee release readiness

Reviewed 27 September 2026. Status: **internal engineering review complete; reviewed code is ready for controlled devnet acceptance, mainnet not cleared**. Internal engineering review, not an independent security audit. No percentage guarantee is assigned.

## Verified evidence

- Earlier live devnet lifecycle: Token-2022 launch, fixed shares, DBC collection and payout, graduation, DAMM trading/collection, and cumulative payout reconciled to actual wallet token balances. This used fixture identity attestations, not a real fresh X post.
- Real staging X OAuth, social-profile wallet linking and read-only provider lookup passed. The reconnect fix is deployed separately.
- Fresh isolated install using the frozen patched lockfile: all five workspace type checks, full Next production build, and 466 automated tests pass. The build includes scoped UUID/TOML fixes; no production credentials or live database were used.
- New contract: 11 native Rust tests, 27 compiled claim/security tests and 11 real Meteora binary integration tests pass. Coverage includes the newly enforced DAMMv2-only allocation guard, authority, pause, verifier epoch revocation, packet sizes, accounting, recipient destination, nonce replay, expiry and collection.
- Final deployment subset: 23 tests pass; six desktop/mobile browser tests use a generated Wallet Standard wallet and mocked RPC. Sixteen-write batches are journaled and checked in full before any submission.
- Ten native-addon guard regressions pass; pre/post build scan passes including 32 freshly generated Next traces. Rust cargo-audit reports no vulnerability advisories and three explicitly documented warnings. See the dependency review for remaining npm reachability dispositions.
- All actionable findings from this internal review are resolved. See `fee-escrow-final-review.md`; this is neither an independent audit nor proof of real-wallet acceptance.
- Deployment preparation remains devnet-only. External wallet owns funding, buffer, upgrade and refund authority; local keys create accounts, not authorize the user's wallet. Exact artifact and transaction checks are required.

## Remaining go/no-go gates

1. Coordinate the new devnet program upgrade, control initialization and matching staging client; verify deployed bytes and control state. Previous v1 live receipts do not prove this new artifact.
2. Rehearse the localhost console with the actual wallet extension, including cancellation, reload/resume, uncertain confirmation, buffer recovery, deployed-byte/authority verification and cost accounting. Bounded batching is implemented and reviewed: the 551,432-byte artifact requires 39 write-batch requests plus create/deploy, or 41 application approval requests instead of 615 single-step requests. The extension may still display individual transactions; actual Jupiter behavior remains unverified. The user signs; no recovery phrase is entered into the console or chat.
3. Complete a real-account fresh challenge post → provider verification → wallet claim → chain receipt and balance reconciliation. No post has been published on the user's behalf; existing-post lookup cannot pass a fresh challenge.
4. Keep financial beneficiary bindings immutable unless a separately reviewed wallet recovery/migration policy is implemented. Admin or X verifier alone must not reassign recipients.
5. Implement and rehearse any promised retirement migration. Existing Meteora fee sharing is only a conditional successor; the current retirement inspector cannot authorize closing an active program. Preserve late/unbound recipients, partially claimed balances, future DBC rights and DAMM NFTs.
6. Preserve the tested dependency overrides and build guard through Vercel packaging, review the documented residual dependency warnings, and obtain any required independent contract review. Internal review and automated tests are not an independent audit.
7. Prepare mainnet-specific claim domain, fixed program identity, deployment artifact and application rollout configuration. Current code deliberately gates signing/feature use to devnet.
8. Verify the user's dedicated wallet ownership, backup recovery privately, exact funding/rent/fee limits and intended authority assignment before any mainnet signature. Prior approximate funding estimates are not final quotes.

## Funding and recovery

Do not send deployment funding on the assumption this checklist is complete. The earlier estimate was a budget, not a fixed fee. Storage deposits, temporary buffer deposits, network fees and recipient funds are different categories. Some storage deposits are reclaimable through safe closure; spent transaction fees are not. The present implementation does not promise program closure at any time while preserving active claims.

## Coordinated release order

Review and test the artifact → prepare exact devnet upgrade and rollback procedure → initialize controls under the current upgrade authority → verify runtime state → deploy matching staging client → complete acceptance checks. Mainnet requires a separate reviewed release and explicit wallet approval. Never enable a mainnet flag to bypass an unfinished gate.
