# Staging and production releases

## Environments

| Environment | Git branch | Vercel project    | URL                         | Solana network          |
| ----------- | ---------- | ----------------- | --------------------------- | ----------------------- |
| Staging     | `staging`  | `oneonly-app` (Preview) | https://staging.oneonly.lol | Devnet, test funds only |
| Production  | `main`     | `oneonly-app`     | https://oneonly.lol         | Mainnet                 |

Use staging for development, cofounder demos, and acceptance testing. Promote reviewed changes from `staging` to `main` only after staging checks pass. Do not copy staging environment values into production.

The staging environment has its own free Neon database (`oneonly-staging-db`), cron secret, and devnet pool configurations. It does not use production signup, wallet, token, or transaction records. No production Redis resource is attached; the app uses its existing local cache fallback. If Redis is added later, use a separate resource or the existing environment/project/network namespace.

Staging disables Vercel Web Analytics, sends `noindex` headers and metadata, and displays a persistent test-funds notice. Runtime and build checks reject staging configured for mainnet or the known mainnet database. These guards supplement, rather than replace, separate credentials.

## Deployment workflow

1. Work on a feature branch and open a pull request into `staging`.
2. Run the relevant tests, typecheck, and a Vercel build.
3. Deploy the `staging` branch to the **Preview** environment of `oneonly-app`. Verify the domain, devnet notice, launch settings, and changed flows using test funds.
4. After acceptance, open a pull request from `staging` to `main` for production release. Apply reviewed migrations to the correct database before code that depends on them.
5. Deploy `main` through the `oneonly-app` project and verify production independently.

The `oneonly-app` project is connected to `aptree-labs/oneonly`, with `main` as its production branch. Staging variables must target **Preview** and the `staging` branch only. Assign `staging.oneonly.lol` to that branch. Never use `--prod` for staging. The former separate staging project is retained temporarily for rollback until acceptance testing is complete. The staging domain has a domain-specific Deployment Protection Exception so demos and OAuth callbacks remain publicly reachable; other Preview URLs keep Vercel Authentication.

Prefer Git-triggered deployments from `staging`, or create a deployment with a Git source explicitly referencing that branch. A source archive with only Git metadata did not receive branch-specific variables during the migration; do not assume metadata proves the environment was applied. Verify the actual deployment commit, Preview target, runtime devnet settings, and creator-fee readiness before assigning the staging domain.

Vercel Cron Jobs run on production deployments, not Preview. Staging therefore needs an explicit authenticated invocation of its indexer when a test requires scheduled indexing; production cron continues independently. Do not point the production scheduler or its credentials at staging.

Never deploy a dirty working tree containing unrelated work. Use a clean checkout/archive and verify `.vercel/project.json` identifies the intended project. The repository-root `.vercel` link can refer to a different surface.

## Required staging configuration

- `ONEONLY_ENVIRONMENT=staging`
- `ONEONLY_SURFACE=app`
- `SOLANA_NETWORK=devnet`
- `SOLANA_RPC_URL=https://api.devnet.solana.com` (or a dedicated devnet RPC)
- `APP_URL=https://staging.oneonly.lol`
- `LAUNCHPAD_URL=https://staging.oneonly.lol`
- `DATABASE_URL`: staging Neon database only; never set `MAINNET_DATABASE_URL`
- `DBC_CONFIG_SOL` and `DBC_CONFIG_USDC`: validated devnet configurations
- `CRON_SECRET`: separate random staging secret

The initial devnet configurations use SPL Token. Token-2022 parity requires dedicated Token-2022 devnet configurations before testing that launch path. JUP, MET, stock assets, and mainnet aggregator routes are not available on devnet.

For migrations, use the staging database's direct/unpooled URL and the committed Drizzle migration journal. The public devnet RPC and free database can have rate limits and cold starts; this environment is for demos and correctness testing, not a production throughput benchmark.

## X linking and fee-claim verification

Staging OAuth uses its own callback at `https://staging.oneonly.lol/api/auth/x/callback`, with `X_CLIENT_ID`, `X_CLIENT_SECRET`, and a separate `X_LINK_SECRET`. Register that callback in the X developer application before enabling linking. Production continues using its existing callback/broker path.

The creator-fee preview additionally needs `TWITTERAPI_IO_API_KEY`. Store secrets in Vercel, never in Git or chat. Adding these variables enables the external integrations; a successful readiness response is not proof of a completed login or claim.

See [the implemented escrow preview](./x-fee-escrow.md) and [HTTP API](./x-fee-api.md) for the current flow and configuration. The interface and server implementation are deployed on staging. On 26 September 2026, the escrow was deployed and its live Token-2022 launch → DBC claim → graduation → DAMM claim lifecycle passed. Staging has a dedicated verifier and linking secret. The staging callback and provider credentials are configured. Live profile lookup and retrieval of an existing post passed on 27 September 2026. Real OAuth consent and callback also passed on the former staging deployment before the domain move. After the move, the Git-sourced app Preview returned the devnet page, all creator-fee readiness checks passed, and both staging and production redirected to X with their correct callbacks. Wallet linking and a fresh verification-post claim still require acceptance testing; old posts and test attestations are not proof of that complete integration. The [original plan](./x-fee-sharing-plan.md) records the architecture and rollout criteria.
