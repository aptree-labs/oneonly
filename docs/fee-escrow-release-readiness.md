# Creator-fee release readiness

Reviewed 27 September 2026. Status: **development and devnet validation; mainnet not cleared**. Internal engineering review, not an independent security audit. No percentage guarantee is assigned.

## Verified evidence

- Earlier live devnet lifecycle: Token-2022 launch, fixed shares, DBC collection and payout, graduation, DAMM trading/collection, and cumulative payout reconciled to actual wallet token balances. This used fixture identity attestations, not a real fresh X post.
- Real staging X OAuth, social-profile wallet linking and read-only provider lookup passed. The reconnect fix is deployed separately.
- New release: all five workspace TypeScript checks and 458 automated tests passed before the final two console regressions; all 17 focused deployment tests pass after those fixes. Two isolated desktop/mobile browser tests pass with a generated test wallet and mocked RPC. The local production build compiles. The isolated build has no production database credentials, so its Explore prefetch warning is not a production-data test.
- New contract: 11 native tests, 27 compiled claim/security tests and 8 real Meteora binary integration tests pass, covering authority, pause, verifier epoch revocation, packet sizes, accounting, recipient destination, nonce replay, expiry and collection.
- Deployment preparation remains devnet-only. External wallet owns funding, buffer, upgrade and refund authority; local keys create accounts, not authorize the user's wallet. Exact artifact and transaction checks are required.

## Remaining go/no-go gates

1. Coordinate the new devnet program upgrade, control initialization and matching staging client; verify deployed bytes and control state. Previous v1 live receipts do not prove this new artifact.
2. Reduce the deployment signing burden safely before calling this a fast deployment flow. The current 551,112-byte artifact requires 613 write transactions plus create/deploy: at least 615 separate wallet approvals with the existing single-step console. Any batching or limited upload signer requires its own budget, authority and retry review. Rehearse the localhost console with the actual wallet extension, including cancellation, reload/resume, uncertain confirmation, buffer recovery, deployed-byte/authority verification and cost accounting. The user signs; no recovery phrase is entered into the console or chat.
3. Complete a real-account fresh challenge post → provider verification → wallet claim → chain receipt and balance reconciliation. No post has been published on the user's behalf; existing-post lookup cannot pass a fresh challenge.
4. Keep financial beneficiary bindings immutable unless a separately reviewed wallet recovery/migration policy is implemented. Admin or X verifier alone must not reassign recipients.
5. Implement and rehearse any promised retirement migration. Existing Meteora fee sharing is only a conditional successor; the current retirement inspector cannot authorize closing an active program. Preserve late/unbound recipients, partially claimed balances, future DBC rights and DAMM NFTs.
6. Finish dependency mitigation and independent contract review. Unit tests/internal review are not an independent audit.
7. Prepare mainnet-specific claim domain, fixed program identity, deployment artifact and application rollout configuration. Current code deliberately gates signing/feature use to devnet.
8. Verify the user's dedicated wallet ownership, backup recovery privately, exact funding/rent/fee limits and intended authority assignment before any mainnet signature. Prior approximate funding estimates are not final quotes.

## Funding and recovery

Do not send deployment funding on the assumption this checklist is complete. The earlier estimate was a budget, not a fixed fee. Storage deposits, temporary buffer deposits, network fees and recipient funds are different categories. Some storage deposits are reclaimable through safe closure; spent transaction fees are not. The present implementation does not promise program closure at any time while preserving active claims.

## Coordinated release order

Review and test the artifact → prepare exact devnet upgrade and rollback procedure → initialize controls under the current upgrade authority → verify runtime state → deploy matching staging client → complete acceptance checks. Mainnet requires a separate reviewed release and explicit wallet approval. Never enable a mainnet flag to bypass an unfinished gate.
