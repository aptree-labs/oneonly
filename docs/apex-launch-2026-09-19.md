# Main-domain launch — 19 September 2026

`oneonly.lol` now belongs to Vercel project `oneonly-app` and serves Explore at `/`. The production `LAUNCHPAD_URL` is `https://oneonly.lol`. Existing `/app/...` routes stay valid; `app.oneonly.lol` redirects to the same path and query on the apex with an uncached 307. Immutable metadata/image URLs on the old hostname continue to resolve.

## X account linking

Keep the `oneonly` project and its `oneonly-kappa.vercel.app` alias running: it remains the OAuth backend holding the existing X credentials. The app's `beforeFiles` rewrites forward `/api/auth/x` and its callback to that backend. The explicit entry-path rewrite is required to avoid an empty wildcard adding a trailing slash and causing a redirect loop.

The registered callback remains `https://oneonly.lol/api/auth/x/callback`. The existing shared `X_LINK_SECRET`, profile storage and wallet identity checks are unchanged. A pre-migration callback with its old host's link cookie can finish on that host; other old callbacks redirect with their signed query to the new origin. Wallet sessions are host-only, so an existing visitor may need to reconnect/sign in on the new origin. Saved X profiles remain linked to the wallet.

Verified live: OAuth start redirect and PKCE cookies; unchanged registered callback; forwarded callback cookies using a synthetic cancellation; old metadata URL resolution. These checks do not constitute a completed real-user X login or wallet transaction.

## Official platform token

- Mainnet mint: `AksZnXihEv8gm3uhotkVUVe82N7wPsnGggQRbgrhMgCr`
- Registry ID: `56047be4-27f3-4f72-9041-aa3a218b9198`
- Ticker: `ONEONLY`
- Gold badge is based on this exact mainnet mint, not the displayed name or an X subscription.
- ONEONLY, common numeric substitutions (including 1ONLY and 10NLY), affixes, and single-character imitations are blocked by server-side launch validation and ticker availability. The inactivity job cannot release reserved tickers.
- The token's current metadata has an image but no banner. The page uses existing One Only scene and logo artwork as its banner fallback. No on-chain metadata was changed.

Validation: 46 focused tests including reserved launch rejection, unrelated ticker acceptance, exact-mint badge identity, permanent reservation under inactivity, and X callback/proxy checks; clean release web typecheck; Vercel production build. Unfinished admin work is excluded from this release.
