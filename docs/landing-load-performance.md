# Landing-page data loading

The Explore page sends its first populated card grid in the page response rather than streaming a separate “Loading market…” state. The initial server data seeds the browser query cache; hydration does not need to fetch the same fresh result again. The first four card images load eagerly, with remaining images lazy-loaded.

The page and API normalize filters identically to share the same cache entry. Discovery keeps up to 64 public result snapshots in each server instance. It reuses a snapshot only within five seconds of its original `asOf` and coalesces simultaneous requests for the same normalized query. Misses use the existing shared Next Data Cache. Database setup and price-reference lookup start together. This introduces no additional Redis commands or paid services.

The shared cache may return a stale result during background revalidation. Discovery bypasses it once the listing is 15 seconds old or its USD reference is 30 seconds old. API cache hits also check these timestamps before responding. Browser cache timers inherit those original timestamps instead of restarting when data arrives. Confirmed updates clear the local discovery cache and invalidate the shared discovery tag; in-flight requests cannot repopulate the local cache after invalidation.

Temporary background refresh failures preserve still-valid cards. Expired values are not kept indefinitely during an outage. Market values still depend on the existing indexed pool snapshots and verified quote-asset references; this change does not invent missing prices, change trade execution, or increase indexing accuracy.

## Validation

- 44 focused tests pass: discovery coalescing, reference expiry, public-cache concurrency/outages, browser cache age, ranking, official-token pinning, and pagination.
- Clean-release TypeScript check passes.
- Production build passed; deployed as `dpl_28c87Uf17EGo8QnXgpDaEo776ZKR` to `https://oneonly.lol`.
- Public HTML includes all 15 current cards and four eager images, without the old “Loading market…” placeholder. The card grid occurs much earlier in the response (about 13 KB versus 47 KB in the control sample).
- Same-client sequential curl samples: five before-release requests had median full-response time 0.997 s and maximum 2.123 s; six after-release requests had median 0.901 s and maximum 1.021 s. These are small network-inclusive observations, not a browser LCP measurement or traffic-load guarantee.
- Public listing response includes the original listing and USD-reference timestamps. One listing remains unpriced because its reference is unavailable; no price was fabricated to fill that gap.
