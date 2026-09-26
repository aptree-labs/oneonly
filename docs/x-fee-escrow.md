# X creator-fee sharing — devnet preview

This feature is restricted to the isolated staging app and Solana devnet. It is not a mainnet release or an independently audited contract. Ordinary launches and creator claims on mainnet keep their existing behavior.

## What is implemented

A launcher can allocate 100% of the **creator-fee portion** to up to eight X accounts. The launcher can include their own connected account. This does not change the trading fee, platform portion, or Meteora portion. Account lookup uses twitterapi.io; allocations store stable numeric X IDs rather than changeable handles.

Token creation and creator-authority transfer into the escrow happen in one transaction. If either fails, neither commits. Recipient shares are immutable. Oversized launch transactions are rejected before reserving a ticker; skip the optional first buy or reduce the recipient count. Existing graduated tokens cannot be opted into this path.

The launcher's wallet cannot directly withdraw the allocated fees. Meteora retains responsibility for trading, graduation, and liquidity. The escrow exposes fixed fee-collection instructions; it has no liquidity-principal withdrawal instruction or arbitrary CPI entry point.

Recipients may appear after the launch. They connect X through OAuth and authenticate their wallet with a signature. The financial X-to-wallet binding is immutable in this preview, independently of later changes to their displayed social profile. There is no recovery or wallet-rotation endpoint yet.

## Claim flow

1. **Prepare fees**, when needed: a permissionless transaction collects the relevant DBC or graduated DAMM v2 creator fees into escrow. The caller pays network fees and any new account rent. This does not pay the caller.
2. Choose a token and claim asset with a collected balance. Fees still held by Meteora are labelled separately.
3. Create a fresh ten-minute challenge. It freezes the recipient, wallet, token, asset, requested amount, cumulative cap, escrow, program, and binding version.
4. Publish an original X post containing the exact one-time code. The server checks the post through twitterapi.io against the numeric author ID, original-post type and issuance time. A post can only verify one challenge.
5. Review and approve the claim. The program validates the server's Ed25519 attestation, wallet signature, immutable allocation, cumulative entitlement, expiry, and unused nonce. Payment goes only to the bound wallet's token account.
6. A confirmed on-chain receipt marks the claim paid. Preparing or signing an intent does not mark it paid. Wallet rejection and transaction expiration remain retryable while authorization is valid. A paid nonce cannot pay twice.

Claims currently cover one token/asset at a time. SOL fees arrive as wrapped SOL in the wallet's token account. No automatic unwrap closes an existing user account.

## Trust boundaries

This is wallet authentication plus server-attested X ownership, **not a trustless X oracle or a conventional multisig**. The server verifier is trusted to establish who controls an X identity. The contract enforces allocation, destination binding, accounting and replay limits, but cannot independently read X.

The devnet program remains upgradeable by its deployment authority. That authority could change program behavior. The verifier key is separate from the deployer and remains server-only. Mainnet requires an explicit upgrade/governance policy, verifier operational controls, independent contract review, and a new rollout decision.

Balances and entitlements use integer base units per mint. The ledger credits actual incoming collection deltas, not reported estimates. Entitlement is floor(total collected × basis points / 10,000), minus prior claims. Assets are never summed into one unlabeled number. Rounding dust remains in escrow. Direct donations are not credited as creator-fee revenue.

Recipient leaderboard totals are projections with freshness/coverage indicators. Public reads refresh a bounded number of snapshots; claim issuance always checks current on-chain balances. An RPC outage preserves prior observations rather than replacing them with zero.

## Configuration and checks

See [staging setup](./staging.md) and [HTTP API](./x-fee-api.md). Required server-only configuration:

- `ONEONLY_ENVIRONMENT=staging` and `SOLANA_NETWORK=devnet`
- `TWITTERAPI_IO_API_KEY`
- Existing X OAuth credentials and `X_LINK_SECRET`, with the staging callback registered
- `CREATOR_FEE_PROGRAM_ID`, `CREATOR_FEE_VERIFIER_PUBLIC_KEY`, `CREATOR_FEE_VERIFIER_SECRET_KEY`
- `CREATOR_FEES_ENABLED=true` only after the executable program, verifier config, and devnet lifecycle are validated

Readiness checks verify the network genesis, fixed program address, executable account, on-chain verifier and matching local signing key. Missing credentials or verification errors fail closed. Never put keys into source, fixtures, browser props, or logs.

Migration `0009_purple_nighthawk.sql` adds separate allocation, profile, binding, challenge and balance-snapshot tables. Apply only to the staging database with its direct URL and committed migration journal. It does not change existing token or trading records.

## Validation commands

- `pnpm test` — app, API, database and client tests; no compiled Rust program required.
- `pnpm test:fee-escrow` — explicit compiled-program tests using LiteSVM and downloaded public Meteora devnet binaries. Missing binaries fail this command.
- `pnpm exec playwright test tests/creator-fees.spec.ts` — desktop/mobile UI with explicitly mocked provider responses; no funds or real X posts.
- Build the SBF program and follow the guarded scripts under `packages/fee-escrow/scripts` for devnet deployment/lifecycle checks. These must verify devnet before signing.

The tests cover replay, changed claim scope, wrong identities/destinations, missing or forged signatures, frozen caps, real SPL/Token-2022 transfers, DBC/DAMM fee collection, repeat collection, and transaction packet limits. Mocked provider tests do not establish that live OAuth, provider access or posting is configured; those require a separate real-account acceptance test.
