# Staging and production releases

## Environments

| Environment | Git branch | Vercel project    | URL                         | Solana network          |
| ----------- | ---------- | ----------------- | --------------------------- | ----------------------- |
| Staging     | `staging`  | `oneonly-staging` | https://staging.oneonly.lol | Devnet, test funds only |
| Production  | `main`     | `oneonly-app`     | https://oneonly.lol         | Mainnet                 |

Use staging for development, cofounder demos, and acceptance testing. Promote reviewed changes from `staging` to `main` only after staging checks pass. Do not copy staging environment values into production.

The staging project has its own free Neon database (`oneonly-staging-db`), cron secret, and devnet pool configurations. It does not use production signup, wallet, token, or transaction records. No production Redis resource is attached; the app uses its existing local cache fallback. If Redis is added later, use a separate resource or the existing environment/project/network namespace.

Staging disables Vercel Web Analytics, sends `noindex` headers and metadata, and displays a persistent test-funds notice. Runtime and build checks reject staging configured for mainnet or the known mainnet database. These guards supplement, rather than replace, separate credentials.

## Deployment workflow

1. Work on a feature branch and open a pull request into `staging`.
2. Run the relevant tests, typecheck, and a Vercel build.
3. Deploy the `staging` branch to the `oneonly-staging` project. Verify the domain, devnet notice, launch settings, and changed flows using test funds.
4. After acceptance, open a pull request from `staging` to `main` for production release. Apply reviewed migrations to the correct database before code that depends on them.
5. Deploy `main` through the `oneonly-app` project and verify production independently.

Automatic Git deployments require the Vercel GitHub App to be authorized for `aptree-labs/oneonly`, then the staging project's production branch set to `staging` and the app project's branch set to `main`. Until that integration is connected, deploy the reviewed branch manually using the matching Vercel project. In the staging project, Vercel's `production` target means the stable staging URL, not Solana mainnet.

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

The proposed fee feature additionally needs `TWITTERAPI_IO_API_KEY`. Store secrets in Vercel, never in Git or chat. Adding these variables does not by itself implement escrow or per-claim post verification.

See [the X fee-sharing plan](./x-fee-sharing-plan.md) for the escrow architecture, fresh-post requirement on every claim, verification safeguards, and staged rollout. That feature is not part of the initial staging infrastructure deployment.
