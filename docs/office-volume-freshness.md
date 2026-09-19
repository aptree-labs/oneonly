# Office volume freshness

Office volume comes from on-chain receipts for each registered DBC pool and its
migrated DAMM v2 pool. Trades routed through Jupiter or other aggregators count
when they execute against those pools. Additional third-party pools for the same
mint are not automatically discovered.

## Ingestion

- A minutely authenticated cron runs history backfill and a separate recent-trade sweep.
- An uncached Office totals read also schedules the recent sweep after returning
  the response. A database lease admits one sweep per 45 seconds across instances.
- The sweep reads finalized receipts from the newest 25 signatures per pool, with
  two workers, a 20-second soft budget, and a fair batch of up to 24 pools.
- Historical scans retain separate cursors and fill gaps. DAMM history no longer
  waits for the pre-graduation DBC scan to finish.
- Native amounts are persisted before historical USD lookup. Missing historical
  prices remain unpriced and are retried; current spot prices are not substituted.
- Signature, venue and event-index uniqueness makes overlapping receipt reads
  idempotent. Database leases also serialize each historical pool scan.

## Display

Office refreshes volume every 15 seconds while visible; fees refresh every minute.
Totals use one shared public cache (10 seconds fresh, 5 seconds stale; 3-second CDN
TTL), with no additional 60-second database-result cache. The UI shows both the
response time and the latest indexed trade time. These are deliberately different.

SOL/USDC historical valuation requires a completed one-minute reference candle.
Expect roughly 1–2 minutes for new USD volume under healthy providers, rather than
instant updates. RPC lag, price outages, bursts beyond a sweep, or historical
backfill can take longer. Incomplete-history and unpriced-trade indicators remain.

No schema migration or paid service was added. This uses the existing database,
RPC, Vercel cron and free Upstash cache. More page visitors share the same ingestion
work. A larger pool count or sustained high trading throughput should move receipt
ingestion to a durable streaming/webhook worker instead of increasing browser polling.

## Validation

Regression coverage includes concurrent lease admission, external DAMM buys while
DBC history is unfinished, duplicate receipts, price outages/recovery, failed
receipts, completed-minute price request coalescing, Office totals and shared cache
concurrency/outage behavior. Production checks should verify that the latest indexed
trade advances and that DAMM receipts appear for the official ONEONLY pool.

## RPC throttling and fee snapshots

Production diagnostics identified HTTP 429 responses from the configured RPC.
Background history reads are paced (350 ms between request starts), with a
30-second circuit breaker and read-only public-cluster fallback on throttling or
transport outages. `SOLANA_INDEXER_RPC_URL` can supply dedicated indexing capacity.
The fallback is best effort and itself rate limited; it is not an unlimited RPC.
Modern version-1 receipts are read directly as JSON, avoiding two requests per
receipt. Signing, simulation and broadcast keep their existing connection.

Curve fee totals now batch pool/config accounts and publish all pools or throw,
so Next's last successful cached snapshot survives an incomplete refresh. No
subset of pools can replace the total. USD values still use current prices and
can legitimately fluctuate; the existing label states that. These fee totals
cover the curve phase, not yet DAMM position fees after graduation.

The official ONEONLY mint is prioritized before Explore sorting and pagination.
Search and pair filters still apply, so unrelated search results stay relevant.

## Production verification — 2026-09-19 UTC

Deployed app build: `dpl_5La6ABK9AQyi85T63oDRSHsqsum2`.

- Before: 1,031 trades / $64,700.47 indexed volume; the official token response
  contained only 12 DBC trades despite graduation.
- After: 1,230 trades / $78,575.29 at 21:02 UTC, with the latest indexed trade at
  21:01:58. The official token's latest 100 receipts included 99 DAMM trades.
- Fee snapshot coverage: 18 of 18 pools, versus incomplete subsets before.
  USD valuation is still marked partial where an asset reference is unavailable.
- Newest-sort first result: the exact official ONEONLY mint.
- 53 focused tests passed, TypeScript passed, and the production build passed.
