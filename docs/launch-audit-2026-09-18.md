# Launch audit — 18 September 2026

**Verdict: tested fixes are live; limited rollout only, not an unconditional all-clear.** Post-deployment quotes and desktop/mobile checks passed, and history recovery has started. Complete historical coverage, provider capacity and the remaining limitations below still need attention before a broad marketing launch. This is an application/readiness review, not an independent smart-contract security certification or a load test.

Audited production: `dpl_4vPAVtSzJGC8ohy6kYfzm1QHebf7`, https://app.oneonly.lol. The early-access site is a separate deployment and was not changed. Mainnet verification was read-only; no mainnet transaction was signed or broadcast and no funds were spent. Local execution used the existing approximately 10 MB copied-program fixture, without a validator ledger.

Approved remediation deployed successfully: `dpl_FcD2LHLX39hXVoAW2ffu85nNnsCA`, https://oneonly-4cjcycf53-kade.vercel.app, aliased to https://app.oneonly.lol on 18 September 2026 at approximately 03:08 UTC. Vercel reported READY after a successful production build.

Post-deployment verification, 03:09–03:10 UTC:
- Six public quote requests returned HTTP 200: GIDDY buy/sell in SOL, STABLE buy in USDC, CHILLJUP buy in JUP, ONE buy in CRCLX, and SOL → USDC → STABLE. These are quotes, not broadcasts.
- Live desktop (1440px) and mobile (390px) checks passed with USD chart data, no runtime errors and no horizontal overflow.
- The first scheduled indexer run advanced stored trades from 33 to 94 across the seven pools. GIDDY advanced 29 → 52, ONECAT 2 → 20, 1CAT 1 → 14, and ONE 0 → 7. 1CAT established complete history coverage; GIDDY and ONECAT checkpointed further backfill. Seven ONE trades still lack historical USD prices. Recovery is proven to be progressing, but coverage is not yet complete for all pools.
- No 5xx entries were returned in the early post-release log check. This brief check does not establish an uptime or capacity guarantee.

## Confirmed defects and prepared fixes

| Priority | Finding | Fix and verification |
| --- | --- | --- |
| P1 | Recent-block timestamp lookups repeatedly fail during quotes. Of the 100 most recent 5xx log entries retrieved across deployments in the preceding 24 hours, 78 reported unavailable block timestamps. This sample is not an error-rate calculation. | Quote preparation now reads Solana's Clock sysvar rather than `getSlot` followed by `getBlockTime`. Both activation modes are covered by regression tests; malformed clock data fails closed. Direct quotes against the seven existing mainnet pools exercised the new code. Empty reserves or too-small sell amounts can still legitimately produce insufficient-liquidity errors. |
| P1 | DBC history indexing calls `getAccountKeys()` without resolving versioned transaction lookup tables. Real routed receipts reproduce the exception. Six of seven pools had no completed history coverage despite successful scheduled jobs. | Pass the receipt's loaded addresses. The local database regression indexes a v0 swap and establishes completed coverage. Public mainnet receipts independently confirm the old failure and successful address/event resolution. Production backfill still needs verification after deployment. |
| P2 | Phantom fee-adjusted trades retained the earlier message in the intent. Buyer verification compares against the finalized message, so a legitimate buyer could be refused comment access. | Persist the exact validated signed message and wire when atomically claiming the intent for submission. Existing strict signature, instruction, account privilege and 0.0001 SOL priority-fee limits remain. Regression verifies persisted receipt and one broadcast under concurrent submissions. This does not retroactively repair older receipts. |
| P2 | The full unit run failed to load the Office test suite after its price-service dependency was added. | Isolate that dependency in the test. Full suite now passes. |
| P2 | Installed Sharp 0.34.5 had known high-severity dependency advisories. | Updated app and build tooling to Sharp 0.35.4, and rpc-websockets UUID to 11.1.1. Production build and image-related UI regression paths pass. |

Clock layout reference: [Solana Clock](https://docs.rs/solana-clock/latest/solana_clock/struct.Clock.html). Sharp advisories: [libvips](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).

## Verified controls and execution evidence

- All nine live configurations validated directly on mainnet: SOL, USDC, JUP, MET, SPYX, QQQX, NVDAX, TSLAX and CRCLX. Mint identity, decimals, published supply/fees, migration configuration, permanent LP-lock allocations and platform receiver checks passed. Public configuration reported all nine enabled with USD references.
- Production uses Helius RPC. Persistent database, authenticated indexer secret and X-link secret are configured. No Jupiter API key is configured.
- Twelve scheduled indexer requests in the sampled hour returned HTTP 200. The missing-history finding above demonstrates why HTTP success alone is insufficient.
- Database: seven confirmed launches, four confirmed in-app trades (SOL and JUP buys/sells), one confirmed claim; no pending intents and no anomalous ticker claims. Expired intents include abandoned/unsigned preparations and cannot be counted as transaction failures. No production graduation is recorded.
- Anonymous trade, claim, setup and submit requests returned 401; foreign-origin launch returned 403; unauthenticated cron returned 401. Setup additionally checks the designated owner. Wallet sign-in uses an expiring, atomically consumed signature challenge and HTTP-only, secure, SameSite session cookies.
- Signed transaction tests reject changed trade amounts/recipients/instructions, invalid signatures and excessive priority fees. Broadcast ambiguity preserves the deterministic signature instead of inviting another purchase.
- **122 unit/database tests in 43 files passed; typecheck and production build passed.**
- **16 deployed desktop/mobile fixture cases passed**, covering wallet approval/rejection, fee changes, polling, selling, live quote previews and Office unavailable-data states. These use mocked wallet/API responses and are not mainnet execution evidence. Separate live desktop/mobile checks showed no page errors or horizontal overflow and loaded USD chart data.
- The final local production build also passed **12 desktop/mobile wallet and preview cases** after the audit fixes.
- In-memory execution using copied mainnet programs passed all five stock lifecycles: launch/first buy, curve sell, curve fill, creator fee claim, graduation, DAMM buy/sell and DAMM fee claim. Atomic SOL → stock → launched-token purchase also passed. Optional-first-buy execution passed both zero-buy creation followed by a different buyer, and creation with a first buy.

## Remaining limitations before a broad launch

1. **Verify live quotes and completed history coverage after deployment.** The approved fixes are live. Follow the scheduled indexer; do not claim volume totals or ticker-release coverage are complete while their coverage fields are null.
2. **Provision Jupiter production API capacity.** Keyless requests currently work, but the app has no `JUPITER_API_KEY`. Live logs also contain RPC 429s and unavailable conversion routes. A configured RPC URL alone does not prove the plan has sufficient throughput. No peak-traffic/load test was performed; start with a monitored, limited rollout rather than assuming marketing-scale capacity.
3. **Dependency scan is not clean:** seven remaining advisories (five high, two moderate), zero critical. `bigint-buffer`'s native overflow path is not loaded locally (pure-JS fallback; native build is not allowlisted), but remains an upstream dependency. `image-size` arrives through React Native/Metro tooling; `toml` through Anchor workspace parsing, which the app does not invoke; Jayson uses UUID v4, outside the reported v3/v5/v6 issue; the stream-json advisory concerns filters not used by the browser RPC client. These are exposure assessments, not upstream fixes or guarantees. Avoid broad, untested major-version overrides on launch day; keep them on the remediation list.
4. **Execution limits:** copied-program tests are snapshots, not proof of every live route at every size. Production records establish SOL/JUP trades and a claim, but not all nine live asset lifecycles or a mainnet graduation. Each routed trade is simulated before wallet approval; routes can still disappear, exceed transaction limits or fail under congestion.
5. **Known UX/recovery limitation:** a preflight rejection is currently treated conservatively as an uncertain broadcast and polled until expiry. This prevents duplicate purchases, but can give slow failure feedback. Older fee-adjusted receipts may need reconciliation before comment eligibility works.
6. **Operations:** repository contents are currently untracked; establish a reviewed commit/release baseline and backup/recovery procedure. Vercel retains the previous production deployment for rollback, but this audit did not exercise database restore or incident alerting.

No mainnet spending is required to deploy these fixes or verify the recovery checks. An unconditional production/security guarantee is not supported by this evidence.
