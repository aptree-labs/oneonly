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

## Explore volume subtotal — 2026-09-19 UTC

A single indexed trade with `volume_usd = NULL` previously hid the entire token's
24-hour volume. This is especially noticeable on an active DAMM pool because
new trades can arrive before their historical price candle is available.

Explore now returns the sum of already-priced trades and the number still
unpriced. `volumeComplete` remains false until both history coverage and pricing
are complete. The card shows `Indexed 24h vol.` with a `+` on a positive subtotal;
all-unpriced history remains null and displays `Pricing…`, not a false zero.
Existing historical-price retries and history scans continue unchanged. No live
spot price is substituted for missing historical evidence.

Regression checks cover mixed DAMM pricing, entirely unpriced history, and a
fully covered DBC pool whose historical pricing is incomplete. The rolling
24-hour boundaries, ranking, and official-token pin remain covered as well.

Production check for `dpl_3QqHhqrShRdmZkpp2mz7CLGfnfGi`: ONEONLY returned
`volumeUsd24h: 56942.9832547`, `volumeUnpricedTrades: 2`, and
`volumeComplete: false`. The first landing card rendered `$56.94K+`.
Twelve market-query tests, eight discovery tests, TypeScript, and the production
build passed.

## Faster receipt backfill — 2026-09-19 UTC

DBC and DAMM history pages now request up to 100 signatures instead of 25.
A shared scanner processes three receipts concurrently, overlapping RPC,
historical-price, and database waits. The history RPC's existing 350 ms pacing,
provider cooldown, read-only fallback, and database leases are unchanged.
DAMM history gets up to 20 seconds of the existing overall run budget instead
of 12 seconds. This increases work possible per sweep without raising the
underlying request rate limit or adding a paid service.

Every group saves its last contiguous successful signature. A missing receipt,
truncated log, RPC failure, or ingestion failure leaves the cursor before the
failed transaction. Later successful receipts may already be stored, but replay
uses the existing unique receipt keys; coverage is never certified across a gap.
A short DBC page with an unavailable historical boundary can now contribute its
valid trades without incorrectly declaring history complete. New finalized
trades continue using the independent recent-trade sweep.

The new scanner tests cover three-way concurrency, ordered checkpoints,
mid-page failure, deadline stops, truncated logs, ingestion failure, and the
initialization boundary. Together with existing DBC/DAMM replay, v1 receipt,
lease, RPC fallback, and price tests, 23 focused tests pass. The concurrency test
completes nine simulated 100 ms reads in 300 ms rather than 900 ms; this is not
a claim of a threefold production speedup, where RPC pacing and source latency
still apply.

Cross-check: Meteora's canonical DAMM pool API reported about $117,169 over 24h
for ONEONLY at investigation time. This is graduated-pool data; it is not
substituted for our receipts or added to already-indexed DAMM volume. Phantom's
$149.9K screenshot may also include curve trading or a different observation
window. Its exact aggregation scope has not been verified.
Source: https://damm-v2.datapi.meteora.ag/pools/6fVxZPKh7rScX2H9kDH2rVXSuzXL1bq2d3Mbpo82Sq1d


The first faster-worker run exposed a persistent receipt gap at signature
`5nnyrU5nAdidWGXnPSu2ts3uNTLECR8hwERjrBw7j9evSA9W2riT9pB7Lmc7u5y836NkKQXsPxyWRmjrZqUcggJ`.
The configured provider returned an incomplete receipt; the public finalized RPC
returned a complete successful transaction with a decoded swap for the exact
ONEONLY DAMM pool. History reads now retry missing or truncated receipts using
the public endpoint before leaving the scan paused. Both sources must still
pass the same receipt validation; no gap is skipped. A regression fixture uses
the real public receipt, with a simulated truncated primary response. Public
fallback remains rate limited and is not a replacement for dedicated capacity.


Production verification: `dpl_2xxc6SN5JfosX85y77DxY4k4rEyU` recovered the exact
blocked signature on its 22:04 UTC cron run and reported `Graduated history
continuing next run`, proving the page completed beyond the former barrier.
ONEONLY's priced 24h subtotal advanced from $68,458.75 to $70,368.20; Office
reported 2,107 trades and $158,424.52 at 22:04:52 UTC. These remain incomplete
backfill totals, not a claim of parity with Phantom. All 23 focused tests,
TypeScript, and the production build passed. No paid plan was enabled.
