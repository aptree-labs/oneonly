# Creator-fee staging API

All routes are under `/api/creator-fees`. All responses use `Cache-Control: no-store`. The feature is accessible only with `ONEONLY_ENVIRONMENT=staging` and `SOLANA_NETWORK=devnet`; the status endpoint reports disabled elsewhere.

## Public reads

- `GET status`: `{enabled,network,lookupAvailable,bindingAvailable,escrowAvailable}`. Escrow availability requires the configured executable devnet program and the explicit rollout flag. A database association alone does not enable payouts.
- `GET profiles?q=handle`: resolves one exact handle or X profile URL through twitterapi.io and returns `{profiles:[{xId,username,name,avatar}]}`. Stable numeric account IDs are used for allocation. Profile name/avatar are never accepted from a launch request.
- `GET recipients?query=&offset=0`: `{recipients,hasMore}`. Each row includes identity, token count, and separately labelled balance availability. Pages contain 24 rows.
- `GET recipients/:xId?offset=0`: `{profile,allocations,hasMore}`. Token allocation pages contain 24 rows.

## Authenticated wallet routes

- `GET me?offset=0`: `{wallet,profile,connectedProfile,binding,allocations,hasMore}`. The bound beneficiary `profile` remains stable even if the wallet's social profile changes later; `connectedProfile` is the current verified OAuth identity used when adding an own share.
- `POST bind {}`: freezes the current verified X profile to the authenticated wallet. Wallet authentication proves the wallet signature; existing X OAuth proves X ownership. No automatic reassignment or recovery endpoint exists.
- `POST collect {tokenId,venue?}`: collects creator fees from the selected Meteora venue into escrow, with no payment to the user. Refresh confirmed balances before requesting a post challenge.
- `POST challenges {tokenId,mint,amountAtomic}`: returns `{id,postText,composeUrl,expiresAt,status}` for an eligible recorded escrow allocation. Challenges expire in ten minutes. The requested mint/amount must already be available in escrow; pending Meteora fees are separate. The all-time cumulative claim cap is frozen at issuance.
- `POST verify {challengeId,tweetUrl}`: verifies the exact numeric author, exact standalone challenge code, original post type, and publication time after issuance. Returns `{verified,status,claimReady}`. Verification does not mean a payout occurred.
- `POST claim {challengeId}`: hands the frozen verified scope to transaction preparation; readiness failures do not consume the challenge.
- `POST reconcile {challengeId}`: reconciles the actual chain transaction before marking payment confirmed.

Writes require same-origin requests, an authenticated wallet session, and rate limits. Unique tweet evidence and atomic state transitions prevent duplicate verification. The escrow program—not the UI or database—enforces actual entitlement and one-time redemption. Preparing a transaction must not consume a claim; wallet rejection and expired transactions need recoverable retries.

## Provider setup

`TWITTERAPI_IO_API_KEY` is server-only. The provider uses:

- [Get user by username](https://docs.twitterapi.io/api-reference/endpoint/get_user_by_username): `/twitter/user/info?userName=...`
- [Get tweets by IDs](https://docs.twitterapi.io/api-reference/endpoint/get_tweet_by_ids): `/twitter/tweets?tweet_ids=...`

Both documented responses include `status: "success"`. Requests send `X-API-Key`, prohibit redirects, have a ten-second timeout, and never use a submitted tweet URL as a fetch destination. Provider errors fail closed; callers can retry after delayed indexing.

Secrets are not included in source, client props, logs, or fixtures. The escrow verifier and program deployment configuration are documented with the on-chain integration. Until those are deployed and validated, profiles and allocation editing can be demonstrated, but withdrawals remain unavailable.

## Bounded balance projections

Recipient totals aggregate confirmed observations in Postgres, grouped by mint; different assets are never summed together. Each row includes `balances` with separate `amountAtomic` (escrow) and `pendingAtomic` (Meteora), `lastUpdated`, `coverage: {observed,fresh,total}`, and `balanceStatus` (`available`, `partial`, or `unavailable`). Complete means every token has an observation within two minutes; partial data is labelled rather than shown as an exact total.

A shared 15-second refresh budget scans at most eight oldest allocations, two concurrently. Token-detail reads reuse 15-second fresh/15-second stale cache entries. Provider outages retain the previous observation and timestamp; failed observations never overwrite known amounts with zero. Claim authorization always reads fresh chain balances and never trusts this display cache.
