# Search, initial page content, and chart recovery — 2026-09-19

Published to `https://app.oneonly.lol` as `dpl_HFSd2S2VYzSKrLzmZKMQfs8Phc85` (`https://oneonly-r8muhwcqv-kade.vercel.app`). Isolated release staged from the previous live release, excluding unfinished admin work.

## Search and page loading

- Public discovery has a five-second shared cache, tagged for invalidation after confirmed transactions, fresh snapshots, and scheduled indexing. Open discovery/search views refresh every five seconds and on focus. Browser queries are coalesced, cache up to 50 filter combinations, and briefly reuse stale results while refreshing. A confirmed transaction clears the browser cache; older in-flight responses cannot repopulate it.
- Search input debounce reduced from 250 ms to 120 ms. Opening the search control is prefetched on focus/hover. Repeated fresh searches need no network round trip.
- A valid, available ticker gets a Create action, preserving the normalized ticker and exact pair in the creation URL. Availability is checked live, even when a filter hides an existing token. Category filters do not masquerade as an exact pair. The creation endpoint still validates/reserves the ticker.
- Explore and token pages stream initial database content from the server. Initial token rendering does not wait for a live pool RPC refresh. Independent detail queries run concurrently, repeated pool reads coalesce, and browser refreshes reconcile the live state. Share-popup code loads on demand.
- Display-price lookups have a 250 ms foreground budget, continue in a supported background task, and use only references under 30 seconds old. Execution quotes and creation validation still use live prices.
- This is bounded cache freshness, not an assertion that unindexed on-chain events appear instantly.

HTTP checks confirmed token cards and token heading/metrics/trade form in the initial HTML, and ticker/pair props in the creation response. A warm Explore response was 757 ms total; warm token responses were 803–912 ms with full initial content. Initial cold responses were slower. These are network observations, not controlled browser paint benchmarks; no browser was opened.

## Chart failures

CHILLJUP had eight indexed trades in quote units but zero USD candles. The chart previously hardcoded USD. It now offers USD/actual-pair selection and falls back to quote units with an explicit label when no USD history exists. It never multiplies past trades by today's spot price or fabricates chart points. Existing single-point markers make a first trade visible.

HOMER's history included version-1 external swaps. The installed web3.js reader requested a maximum version of zero and failed before reaching the launch's first buy. The historical receipt adapter now retries the explicit unsupported-v1 error using the documented JSON RPC format and resolves account keys for event decoding. The adapter cannot serialize/sign a transaction; wallet submission and message checks remain unchanged. Both DBC and graduated pool scanners use it.

Confirmed app transactions now schedule receipt indexing after the response. Quote data is persisted before historical USD enrichment, so pricing-provider delays cannot hide the trade. Empty charts can request one background catch-up per pool per minute using a database condition. Chart data refreshes after a user's successful transaction. The five-minute scheduled full scanner remains responsible for complete history coverage and ongoing external activity.

References: [Solana JSON structures](https://solana.com/docs/rpc/json-structures), [Solana getTransaction](https://solana.com/docs/rpc/http/gettransaction).

## Validation

- 222 tests passed; workspace typechecks and Vercel production build passed.
- Regression fixtures include a real finalized HOMER v1 swap. Tests verify decoded pool identity, completed scan coverage beyond that receipt, failed receipt rejection, first-buy persistence before slow USD enrichment, and idempotency without erasing a known USD value.
- Tests also cover cache deduplication, filter isolation, expiry, invalidation races, provider timeouts, safe prefill, saved initial details, and USD/pair fallback.
- Read-only chain verification and public HTTP checks only. No mainnet transactions were signed or sent for testing.

Final live verification: HOMER returned three 1-minute USD candles containing all five finalized trades, including the launch's first buy, with history coverage through `2026-09-19T10:35:11Z`. CHILLJUP returned three 1-minute JUP candles containing eight trades with `currency: quote` and `fallback: true`. No extra user configuration was necessary.
