# One Only caching and capacity

Target: **1,000,000 visits/month**, not simultaneous users. Assumptions below are planning inputs, not measured capacity guarantees.

## Request path

Browser reuse + in-flight deduplication → Vercel CDN → bounded process cache → shared Upstash Redis → origin Postgres/RPC. Vercel Data Cache remains a shared fallback when Redis is absent or unavailable. All cache entries are disposable. The database and chain remain authoritative.

- Public JSON allowlist: discovery/search, token details, candles, configuration, anonymous trade assets, office totals.
- Market data: 5s fresh + up to 10s stale while refreshing; edge 3s fresh + 3s stale. Configuration: 10s + 10s, edge 5s + 5s. Office totals: 30s + 30s, edge 10s + 10s (existing aggregate cache also 60s).
- These are layered TTLs, not a promise that all displayed data is at most 5 seconds old. Database indexing coverage and upstream price timestamps remain separate. Confirmation invalidates discovery's underlying Next cache; existing Redis/edge views converge on TTL. Quotes and ticker reservations recheck authoritative state.
- Cache keys include project, deployment/environment, chain, token, and normalized filter parameters. Prices/timestamps are no longer part of discovery keys. Unknown public filter parameters are rejected instead of becoming arbitrary cache busters.
- Only explicit public handlers are wrapped. No sessions, portfolio/balances, wallet-specific trade assets, signing challenges, ticker availability, transaction previews, intents, submit, creator claims or other mutations in shared caches. Errors and Set-Cookie responses cannot populate the cache.
- A Redis lease allows one rebuild per key across servers. Cold contenders wait briefly, then return retryable 503 instead of duplicating work. Expired lease holders cannot overwrite a newer Redis result. In-process requests coalesce; memory is bounded to 500 entries/16 MiB, 512 KiB per entry, and 32 active distinct loads.
- Redis calls time out after 800ms and a failing instance backs off for 10s. Origin failures can use stale data only within the stated window. Failures are not cached as successful empty lists.
- Token snapshot reads no longer flush every discovery entry. Confirmed changes and indexing still invalidate the underlying discovery cache.
- Explore polling: 10s (was 5s); chart/token polling: 15s. Hidden charts stop polling, overlapping chart requests do not queue. Search keeps debounce and browser deduplication.
- Display prices on wallet asset panels reuse the shared display cache. Execution's price/slippage/balance/signature checks are unchanged.
- Neon runtime connections use its `-pooler` endpoint, five connections per process, 10s connect timeout, 20s idle timeout, 30min lifetime. Migration URLs remain explicit/direct. The isolated mainnet database name is preserved.

## Provisioning and budget

Upstash store `oneonly-market-cache`, Vercel resource `store_BAPivL88jlUtkRi2`, primary region iad1, connected to **oneonly-app production only**. Credentials are injected as KV_REST_API_URL/KV_REST_API_TOKEN; UPSTASH_REDIS_REST_URL/TOKEN are also supported. Never use NEXT_PUBLIC credentials.

Owner chose **Free**: 256 MB, 500,000 commands/month, 10 GB bandwidth. Automatic upgrades disabled; eviction disabled. This is not a million-visit capacity guarantee. Command count is not visit count: GET, lock, script operations and refreshes consume the allowance. Cache quota exhaustion falls back to Vercel's cache/origin and can increase latency and DB/RPC load.

Transaction/auth rate limits intentionally remain on the existing atomic Postgres limiter while using this free cache. Optional shared Redis limiter is implemented/tested but **disabled** (`ONEONLY_REDIS_RATE_LIMITS` unset). Do not enable it against this free quota or an evicting store. When enabled it fails closed on Redis outages, so it needs a separately budgeted reliable store/plan and monitoring. The optional origin miss limiter also requires this flag. Vercel edge/firewall protection remains essential for high-cardinality abusive traffic.

## Capacity model

1M / 30 days ≈ 33,333 visits/day ≈ 0.386 arrivals/second. With 120s average active dwell: ≈46 concurrent visitors on average. At 20× arrival bursts: ≈926 concurrently active visitors. At 100×: ≈4,630.

At 926 active traders, a 15s chart poll and a 15s token poll generate ≈124 public requests/s before caching. Shared keys collapse origin work; 926 visitors spread over 926 different tokens do not share those entries. Two pages/visit and 2min polling can generate tens of millions of monthly HTTP requests. CDN hits still incur traffic/bandwidth costs.

The active pool count, geographic distribution, search diversity, trade frequency, wallet balance requests, bot traffic and session length determine real resource demand. Unique authenticated quotes and three RPC balance reads per wallet refresh remain uncached. Redis cannot remove their upstream requirements.

## Operational gates before a major traffic campaign

1. Check Vercel requests, transfer, function duration/errors, CDN hit ratio, Redis commands/bandwidth and Neon active queries/connections daily during ramp-up. Alert at 50/70/90% of free Redis quota; these are recommended thresholds, not an installed monitoring service.
2. Stage a synthetic public-read test at 100, 500, then 1,000 active clients using a realistic hot-token/search distribution and 15s polling. Measure p50/p95/p99 and failure rate. Separately test authenticated quotes against an isolated network/funded test setup. Do not stress production or spend mainnet funds as a load test.
3. Suggested public-read acceptance targets: warm regional CDN p95 under 300ms, cached-origin p95 under 1s, fewer than 0.1% unexpected errors under target burst; verify fresh quotes separately. These are targets, not results.
4. Confirm dedicated RPC/Jupiter limits against peak uncached demand. Add provider fallback and bounded retries where warranted. Public/keyless pricing and historical-data rate limits remain reliability constraints.
5. As trade/pool count grows, move rolling-volume/recent-buy aggregation to indexed/materialized summaries and incrementally precompute candles. Current search aggregation scans trade history on cache misses. Profile plans on a Neon branch before changing SQL/indexes.
6. Split the five-minute all-pool indexer into bounded resumable jobs/queue as active pools grow; cache freshness cannot repair delayed/missing index data. Full-table Office analytics should use incremental totals at larger transaction volumes.
7. Apply managed bot/rate rules at Vercel's edge for high-cardinality read abuse, while excluding legitimate cron and wallet paths as appropriate. No new firewall rule or paid protection product was configured in this change.

## Verification / rollback

Unit tests cover a 1,000-call burst → one origin read, independent instance reuse, lock contention, bounded stale-on-error, failed refresh retry, origin concurrency limit, private-route exclusions, search normalization, limiter behavior, and Neon pool URL preservation. This is a cache correctness test, not a million-visitor benchmark.

Run `node scripts/check-public-cache.mjs https://app.oneonly.lol` for 12 read-only requests reporting timings, HIT/MISS and private headers. Do not use a cache-busting parameter or a no-cache request header to measure normal CDN hits.

Rollback the application to the previous deployment if needed; Redis values are deployment-namespaced and expire. Disconnect/remove Redis env variables and redeploy to use the Vercel Data Cache fallback. No schema migration or changes to transaction signing were introduced.

References: [Vercel CDN headers](https://vercel.com/docs/caching/cache-control-headers), [Vercel Redis marketplace](https://vercel.com/docs/redis), [Upstash Redis pricing](https://upstash.com/pricing/redis), [Upstash REST API](https://upstash.com/docs/redis/features/restapi), [Neon pooling](https://neon.com/docs/connect/connection-pooling).

## Live verification, 2026-09-19

Deployed to app.oneonly.lol: `dpl_D3U7frcuTGvm5MPWZ1oKLGKEvLU2`.

- Final smoke: search MISS 806ms, subsequent HIT 146/147ms; configuration MISS 2653ms, HIT 162/133ms. Earlier cold deployment misses were 3193/3569ms. These are small sequential network samples, not percentiles or a controlled before/after benchmark.
- Token details HIT 414ms, chart HIT 174ms with existing HOMER candle returned, anonymous assets HIT 141ms.
- Session, ticker availability and wallet-parameter asset responses remained `no-store`/MISS; unknown cache-busting query returned 400/no-store.
- Five live public Redis entries observed, sample TTL 9s. Disposable Redis write/read/delete succeeded. Read-only Neon pooled connection succeeded.
- Full suite before final policy tightening: 247 tests passed; final policy suite: 15 tests passed (one additional duplicate-filter test). All workspace type checks and production build passed. No browser interaction or mainnet transaction was performed.
- Free plan retained, automatic upgrades disabled, optional Redis transaction limiter disabled. No production load test, new monitoring automation, or new firewall rules were claimed or run.
