# One Only

One Only is a Solana token launchpad built around unique tickers, with Meteora bonding curves, automatic trade routing, and on-chain activity indexing. It is a pnpm + TypeScript monorepo. Original art and sounds live in `assets/`; `bible.md` is product context.

[Live app](https://oneonly.lol) · [User docs](https://oneonly.lol/app/docs) · [Telegram support](https://t.me/OneOnlylol_bot)

## Current production release

The launchpad runs at **https://oneonly.lol**; local development defaults to devnet. Production public-data caching and traffic analytics are documented in [caching and capacity](docs/caching-and-capacity-2026-09-19.md) and [Web Analytics](docs/web-analytics.md). See [mainnet operations](docs/mainnet.md) and the [Token-2022 rollout](docs/token2022-rollout-2026-09-19.md) for configuration and remaining owner-controlled setup.

This snapshot matches the deployed launchpad source. Environment secrets, local database files, build output, and unfinished admin work are excluded.

## Start locally

Requires Node.js 22+ and pnpm 10.28.2.

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000. No Docker or database credentials are needed: the first signup initializes PostgreSQL-compatible PGlite, applies the checked-in Drizzle migrations, and persists data in `apps/web/.data/oneonly/`.

## Workspace

- `apps/web` — Next.js App Router: landing page, mainnet launchpad, wallet sign-in, and server transaction APIs.
- `packages/protocol` — pinned Meteora DBC SDK, network guards, exact-input quotes, and chain event decoding.
- `packages/core` — Effect schema decoding, typed validation failures, and Solana public-address validation.
- `packages/db` — shared Drizzle schema, migrations, PostgreSQL/PGlite drivers, and idempotent signup persistence.
- `assets` — untouched source artwork and MP3s.
- `scripts/optimize-assets.mjs` — reproducible optimized scene assets and character hit regions.

The landing page is statically prerendered. Effect and database clients stay on the server. Character poses share a cropped coordinate frame; each pose gets its own tap region derived from its nontransparent pixels. Only the current character plays audio, a second tap stops it, and sound stops when the tab is hidden. Mute persists in local storage. Reduced-motion preferences are respected.

The background is provided in responsive AVIF and WebP sizes, and transparent character sprites are WebP. The action poses load on hover, keyboard focus, or tap; audio downloads only after an explicit character click. Fonts are self-hosted. Run `pnpm assets` after replacing source assets. File sizes are recorded in `apps/web/public/scene/manifest.json`.

## Early access

Wallet signup validates base58 decoding to exactly 32 bytes, preserves address case, and deduplicates at the database level. It records a public address only, without wallet connection or proof of ownership. X signup records only the stable X user ID and username; access tokens are not persisted. Wallet and X are independent alternatives, not linked identities.

### X OAuth

Copy `apps/web/.env.example` to `apps/web/.env.local`, and configure:

```dotenv
APP_URL=http://localhost:3000
X_CLIENT_ID=your-client-id
X_CLIENT_SECRET=your-client-secret
```

In the X developer portal, enable OAuth 2.0 for a Web App and register the exact callback:

```text
http://localhost:3000/api/auth/x/callback
```

Use `users.read tweet.read` scopes. Production uses the same callback path on your HTTPS `APP_URL`. The implementation uses authorization code + PKCE, random state, expiring HttpOnly/SameSite cookies, and server-side token exchange. The client secret is optional for public OAuth clients, and required for confidential clients configured to use client authentication. Without credentials the site offers wallet signup and honestly reports that X is unavailable. A live X round trip needs your developer app credentials; no fake identity is created.

### Production PostgreSQL

Set `DATABASE_URL` and the public HTTPS `APP_URL`. Export `DATABASE_URL` into the shell before running migrations (the workspace CLI does not automatically load the web app's `.env.local`):

```sh
pnpm db:migrate
pnpm build
pnpm start
```

Schema changes: edit `packages/db/src/schema.ts`, run `pnpm db:generate`, inspect the generated SQL, then run `pnpm db:migrate`. PGlite applies the same migrations automatically in development. Production never silently falls back to PGlite. For a local production preview only, run `ALLOW_PGLITE=true pnpm start` after building. PGlite's file storage is for a single local process; production replicas use PostgreSQL.

The signup endpoint restricts request origin and content type, caps request bodies, validates server-side, and uses unique constraints. Before public deployment, configure request-rate limits at your hosting gateway for `/api/early-access` and `/api/auth/x/*`; there is no distributed rate limiter or CAPTCHA in this initial site. This implementation records interest; it does not send notifications or allocate trading access.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Unit tests cover Effect validation, actual PostgreSQL migrations in PGlite, and concurrent duplicate signups. Playwright checks desktop and mobile interactions, mute persistence, validation and successful submission, OAuth fallback and state rejection, and API request boundaries. Install the Playwright Chromium browser with `pnpm exec playwright install chromium` if it is not available. `node scripts/visual-check.mjs` captures desktop/mobile screenshots under the system temporary directory while the local server is running.

## Live site and sharing

Production: **https://oneonly.lol**, Vercel project `oneonly-app`, root directory `apps/web`, Node.js 22. The app uses its own PostgreSQL database. The former early-access deployment remains a separate X OAuth backend; the main app forwards the existing authentication paths to it. See the [main-domain launch notes](docs/apex-launch-2026-09-19.md) before changing that routing.

The metadata source is `apps/web/src/lib/site.ts`. It uses the canonical production domain for Open Graph, the X large-image card, the sitemap, and crawler discovery. The 1200×630 JPEG is a static, publicly fetchable file, so social crawlers do not need JavaScript or an image-generation server. The supplied official logo is in `assets/brand/oneonly-logo.jpg`. Optimized WebP logo sizes accompany a 64px PNG tab icon, 16/32/48px favicon, 180px Apple icon, and 192/512px app icons.

Run `pnpm assets:brand` to regenerate the favicon and social image from the supplied official logo and existing artwork. This uses a local Playwright Chromium browser. If replacing the social preview after it has been shared, change the versioned filename in both the generation script and `site.ts` to give X a fresh image URL.

### Enable production X connection

In https://console.x.com, configure the app for OAuth 2.0 as a **Web App** (confidential client). Copy its **Client ID** and **Client Secret**, then add them as `X_CLIENT_ID` and `X_CLIENT_SECRET` in the Vercel project's Production environment. Register these exact values in X:

- Website: `https://oneonly.lol`
- Callback / redirect URL: `https://oneonly.lol/api/auth/x/callback`
- Read scopes used by the app: `users.read tweet.read`

Use the OAuth 2.0 client credentials, not the OAuth 1.0 API key or an app-only bearer token. The X app needs API access to `GET /2/users/me`. No write/posting permission, email access, or offline access is requested. Redeploy after saving the variables, then test a complete consent round trip. Until credentials are added, visitors can join with their Solana public address.

Prepare an isolated release with `node scripts/prepare-release.mjs landing` or `node scripts/prepare-release.mjs app`, then run `vercel deploy --prod --scope kade` in the printed directory. The landing release excludes app routes and the app release includes its activity cron. Local `.vercel` project links, environment files, and database files are ignored by Git and excluded from uploads.

## Trading app

The app lives at **https://oneonly.lol**, with its own PostgreSQL database. The former `app.oneonly.lol` hostname redirects to the main domain. Local routes start at `/app`. See [the app operations guide](docs/launchpad.md) for configuration, transaction guarantees, inactivity rules, tests, and current scope.

### Signup sharing and updated scene audio

Successful wallet signup and the successful X OAuth return open a dismissible share dialog with the supplied early-access artwork and the caption `r*tarded memefi era`. The X button opens a draft using a [Web Intent](https://docs.x.com/x-for-websites/web-intents/overview), with a link to `/early-access/share`. That public page has dedicated image-card metadata; it does not include a wallet address or X identity. The dialog also offers the original JPEG as a download for attaching directly in X. It never posts automatically. X credentials are still required to test the complete OAuth exchange; the browser suite covers the successful client return state separately.

`pnpm assets:signup` regenerates the responsive popup images, a landscape social preview that contains the complete square artwork, and `/sounds/pee-v2.mp3`. It requires ffmpeg. The sound is a 5.2-second mono excerpt of `assets/sound-library/Peeing on Ground.m4a`, starting at 2.1 seconds to skip the quiet lead-in, with short fades matching the character's action duration. The new image and sound are fetched only when the associated interaction occurs.
