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


## Live devnet validation — 26 September 2026

The deployed program is [`BJk7HqbLecWFBFxFTULnmpSwmViLg9FeRLBajewvJ3g4`](https://explorer.solana.com/address/BJk7HqbLecWFBFxFTULnmpSwmViLg9FeRLBajewvJ3g4?cluster=devnet). Its deployed bytes match the tested artifact SHA256 `c750f70aa4fab8be7169362df11c1dc1f15dd642b6e71b9a45245fbefdd67f69`.

A fresh Token-2022 mint [`2GjDc5HfPbXEGebfnN7nqNhtyXGZH7JGUrVkYxiFncMb`](https://explorer.solana.com/address/2GjDc5HfPbXEGebfnN7nqNhtyXGZH7JGUrVkYxiFncMb?cluster=devnet) was launched with two recipients split 25% / 75%. The dedicated 0.2 SOL graduation configuration is a lifecycle-test fixture; it is not the staging platform's launch configuration.

| Verified step | Devnet receipt |
| --- | --- |
| Atomic Token-2022 launch and allocation | [Launch](https://explorer.solana.com/tx/Uthe6MVLgLpbAX2j7dhB2gfkAjcEqNR9uVrTAMRkAhC1aDJwwsCAJXu2x9BoWzAnfAex5tjhFkQqWXE75dgiqXa?cluster=devnet) |
| DBC fee collection and first claim | [Collection](https://explorer.solana.com/tx/4TBArCd9zgWND5AknCSvgRjcyk5E5SVfJS65XAxL3fQKog3kEy8sCUMZFuRqPa4yke8TxM3xNgZiSwzyQkw6ji2f?cluster=devnet), [claim](https://explorer.solana.com/tx/53ECXrXw1DdMugyqdY6VBTvcvTCBMgxmXzyE43RjotqQWY8TDYxxrekpu7MA65vhBLXfdu7UQoTWAg95YiVmFodr?cluster=devnet) |
| Graduation to DAMM v2 | [Graduation](https://explorer.solana.com/tx/2akek3DTdi64jc3rCdpcGuw2wUcDmi3KBP9mK3hKtKctqFRx4HtnRn2tV2C5iikoyESszHhMtjCwV5kbHg97ZawF?cluster=devnet) |
| DAMM buy and sell | [Buy](https://explorer.solana.com/tx/tBxr7HAAAeZP3U4rH8ZRp2hEDHZz9PxLmJSmAQpun2vNsEEPXG8JTgDXzijxNVDbT44ko7taU3xp3FhLkEwKFa1?cluster=devnet), [sell](https://explorer.solana.com/tx/5zYLHdJFi9ssVBT9bog5YYCg7XWp5uoXPUnjAJmkBwfoEjdo9iB67PQjdcy1Viv1bf7yuHTxByvS8DDdaNC2bZa8?cluster=devnet) |
| DAMM fee collection and second cumulative claim | [Collection](https://explorer.solana.com/tx/3CFEVZvuW2Gr1sprwi2nrje3cp9snD4BVcbY55BSvLyU75WWmTes5d6wUQ1EbVZvBKWKqt8s8ya9fsE79AQFAu4T?cluster=devnet), [claim](https://explorer.solana.com/tx/2NyM842E9zqEKHz3r2XGL617P5W5nNycUTBgPPk4xswZ88o1hcQJyJDCYj3eSK5EVu5GttgrsnqGvJjhf46bQmQD?cluster=devnet) |

The 25% recipient received exactly 125,000 wrapped-SOL base units on the first claim and 129,165 additional units on the second, for a cumulative 254,165. The runner checked the recipient's actual token-account balance delta against the cumulative entitlement after each claim. It also collected remaining DBC fees after graduation.

The final DBC buy initially returned an expiry error from confirmation, but finalized successfully on-chain. Its signature was reconciled before proceeding; the trade was not repeated. The runner now persists pending signed transactions and rebroadcasts the same bytes, rather than treating a confirmation timeout as permission to send a new trade. A subsequent completed-run check passed without sending new transactions and reverified both claims from transaction balance metadata.

This validates the on-chain lifecycle with a fixture X identity and a test verifier attestation. Live OAuth, wallet linking and a real X post still need an acceptance test once the staging provider credentials are configured. No mainnet deployment or production configuration was changed.
