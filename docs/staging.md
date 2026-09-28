# Staging and production releases

| Environment | Git branch | Vercel target                                  | URL                         | Solana network                                                |
| ----------- | ---------- | ---------------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| Staging     | `staging`  | `oneonly-app` Preview, branch-scoped variables | https://staging.oneonly.lol | Mainnet, explicitly enabled for real-funds acceptance testing |
| Production  | `main`     | `oneonly-app` Production                       | https://oneonly.lol         | Mainnet                                                       |

Staging tests the deployed mainnet escrow before approved changes are promoted to production. The old `oneonly-staging` project is not the release target. Production creator-fee sharing requires `ONEONLY_ENVIRONMENT=production`, `SOLANA_NETWORK=mainnet-beta`, and `CREATOR_FEES_ENABLED=true`.

## Isolation

Staging keeps `ONEONLY_ENVIRONMENT=staging`. Selecting mainnet additionally requires `STAGING_MAINNET_ENABLED=true`; without that opt-in the staging runtime rejects mainnet. Devnet remains supported for test-funds development.

Mainnet staging uses a separate empty `oneonly_staging_mainnet` database inside the existing staging database service. It never uses `MAINNET_DATABASE_URL` or the production `oneonly_mainnet` database. The devnet database remains intact. Cache keys, wallet cookies, session hashes and X-session proofs have distinct staging/network scopes. Users must sign in again after the network switch. No production sessions or token records are copied.

The staging catalog is separate from the production catalog. On-chain transactions are real and visible publicly; this is not a private blockchain or a way to undo a token launch. Use clearly identifiable test tickers. The permanent staging banner identifies the mainnet environment and real funds. Analytics and indexing by search engines remain disabled.

## Branch-scoped Preview variables

- `ONEONLY_ENVIRONMENT=staging`, `ONEONLY_SURFACE=app`
- `STAGING_MAINNET_ENABLED=true`, `SOLANA_NETWORK=mainnet-beta`
- `SOLANA_RPC_URL`: mainnet RPC
- `APP_URL` and `LAUNCHPAD_URL`: `https://staging.oneonly.lol`
- `DATABASE_URL`, `DATABASE_URL_UNPOOLED`: isolated `oneonly_staging_mainnet` database; never `MAINNET_DATABASE_URL`
- `DBC_CONFIG_*`, including Token-2022 overrides, and `ONEONLY_FEE_WALLET`: verified existing mainnet configurations
- `CREATOR_FEES_ENABLED=true`, the deployed mainnet `CREATOR_FEE_PROGRAM_ID`, and matching `CREATOR_FEE_VERIFIER_PUBLIC_KEY`/`CREATOR_FEE_VERIFIER_SECRET_KEY`
- Existing staging `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_LINK_SECRET`, `TWITTERAPI_IO_API_KEY`, and `CRON_SECRET`

The mainnet verifier is separate from devnet. Its claim domain is `oneonly:fee:v2:mainnet-beta`; the SDK rejects a program/network mismatch. Deployment and upgrade authority remains the user's dedicated wallet. The verifier has no upgrade authority.

## Release and acceptance

1. Merge reviewed code into `staging`, run tests/typecheck/build, and deploy that branch as Preview in `oneonly-app`.
2. Check the deployment's network, isolated database, X callback and escrow readiness before moving the staging domain.
3. On staging, connect a mainnet wallet, link X, launch a token allocating creator fees, trade, collect and claim. A claim still requires a fresh one-time X post. Existing posts only test the provider's read API.
4. Promote to `main` only after acceptance and explicit production release. Do not copy staging database or verifier settings blindly into Production.

The compiled mainnet artifact has been tested locally for a successful mainnet-domain claim and rejection of a devnet-domain attestation. These tests do not substitute for the user's real X-post-to-mainnet-payout acceptance test. No test post is published automatically.

Preview deployments do not run Vercel production cron jobs; acceptance testing should use the app's collection and confirmation flows rather than assume a minute-by-minute background scan.

## Production creator-fee configuration

Production uses its existing database, cache namespace, X link secret, and OAuth broker. Configure the verified mainnet program and matching verifier key pair, `TWITTERAPI_IO_API_KEY`, and `X_CLIENT_ID` in the Production target. The original OneOnly project continues to hold the OAuth client secret and handle login through the existing rewrite. Apply the creator-fee database migration before enabling the release.

Never copy the staging database, staging environment flags, or `CREATOR_FEE_TEST_GRANT` into Production. Internal test proofs are rejected outside staging. Production claims require fresh X-post verification and wallet approval.
