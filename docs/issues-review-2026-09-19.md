# PDF issue review — 19 September 2026

Source: `/Users/don/Downloads/Untitled document (1).pdf` (six pages, visually reviewed). These screenshots overlap the previous issue report. This pass verified the deployed fixes; it did not make another application change or deployment.

## Findings

| Reported issue | Current result |
| --- | --- |
| Debited SOL but no tokens | The supplied finalized receipt `3ZtNus3syypMDfKJhCvmvpu6HZSRLBGWhxFWXwjcJQKwnanDCvYqSJbe7jKXnSH8AsGpVUbxNv9t758AroAKWX7f` is ONE's launch with no first buy. Its previously retrieved immutable receipt shows a 0.02064384 SOL debit, including 0.0000114 SOL network fee; the rest funded account creation. The 1 billion tokens were minted to the pool vault, not purchased for the creator. It contains pool initialization, not a swap. |
| Max/copy notification visibility and missing USD values | Fixes are deployed. Live desktop/mobile checks loaded USD metrics and chart data, and confirmed dark text on the copy notice. No runtime errors or horizontal overflow at 1440px and 390px. |
| Wallet changed the transaction | Direct wallet approval and bounded priority-fee compatibility are deployed. The 12 deployed-frontend fixture cases passed, including wallet fee edits, selling, delayed confirmation and rejection. Wallet/API responses are mocked in these regressions: they do not prove every live Phantom interaction. |
| Blockchain service busy | Six live read-only quotes passed: SOL buy/sell, USDC buy, JUP buy, CRCLX buy, and SOL → USDC → STABLE. Response times were 665–2,181 ms. The recent two-hour production 5xx log query returned no entries. This is a sample, not a capacity or uptime guarantee. |
| STABLE claimed but missing | Live ticker lookup resolves to `5597ce47-b581-4f66-8caa-375ee67fcc72`. Live Explore search returns that active USDC token. The create form links claimed tickers to their existing token; desktop/mobile regression passed. |
| Office totals should use USD | Aggregated USD revenue and creator payouts are deployed and returned by the live endpoint. Its `complete` flag is false: unavailable historical prices/coverage must not be presented as complete totals. |
| Claim button wording | Source uses “Claim fee”; included in the already deployed fixes. |
| Single-character name | The app's validation was changed to allow it. Create-form regression with name `1` passed on desktop/mobile; the earlier validation screenshot is outdated. |
| Fomo says STABLE has no liquidity | Our live USDC quote returned 315,906.386726 STABLE for 1 USDC; SOL routing also returned a quote. This does not verify Fomo support. Its warning cannot be cleared by changing our UI or inventing volume. |
| P&L on share image | Not implemented. The sell popup confirms a sale and provides artwork; it does not calculate realized profit/loss or cost basis. |
| Artificial buys | Not implemented. Genuine independent purchases are supported; artificial trading volume is not part of this remediation. |

STABLE: https://app.oneonly.lol/app/token/5597ce47-b581-4f66-8caa-375ee67fcc72

## Remaining evidence gaps

Read-only database check at 06:08 UTC: GIDDY now has 682 indexed trades with completed backfill, versus 52 immediately after the preceding deployment. STABLE and CHILLJUP also have completed scan coverage. ONE still has pending backfill and four unpriced trades; CHILLJUP has eight unpriced trades and MAGAJUP has two. Historical USD data remains incomplete. No broad-launch all-clear follows from this review.

No mainnet transaction was signed or sent, and no funds were spent. Public quote requests, public UI checks, aggregate read-only database queries and mocked wallet regressions were used.

## Correction: launch-cost breakdown

Further inspection of the same receipt's inner instructions identifies 0.0137338 SOL transferred during Metaplex metadata creation. This includes the Metaplex creation charge as well as metadata account rent; it should not be described as entirely account rent. The other mint/pool/vault accounts consumed 0.00689864 SOL and the transaction fee was 0.0000114 SOL, totaling 0.02064384 SOL. Meteora's Token-2022 initialization uses the mint's native metadata extension instead of Metaplex. It avoids that separate Metaplex creation path, but still funds the extended mint, pool and vaults and pays network fees. A comparable simulation is needed to quote an exact Token-2022 launch total.
