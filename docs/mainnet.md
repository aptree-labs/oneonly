# Mainnet release

The app now supports `SOLANA_NETWORK=mainnet-beta`; devnet remains the default for local tests. Production mainnet uses `MAINNET_DATABASE_URL` with the dedicated `oneonly_mainnet` database. The old devnet database and immutable deployment remain intact. Early access at oneonly.lol is separate.

## Verified issuer assets (2026-09-13)

The five assets are specified in the original bible.md. Addresses came from the [issuer’s public API](https://docs.xstocks.fi/apis/openapi/assets), then were checked using Solana mainnet RPC. All five use Token-2022 with eight decimals and have program-owned Meteora DBC token badges.

| Asset | Solana mainnet mint                           | DBC token badge                                |
| ----- | --------------------------------------------- | ---------------------------------------------- |
| SPYx  | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | `D2THzeQLHaDeKBzzmTNuWEWw23WPM8vVhLvUmSPEpNeL` |
| QQQx  | `Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ` | `6nenkWN8CPvKLoqZTf5CFpkGq6PcR5i7KvLcmbCS5RoE` |
| NVDAx | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | `mfacWnGh1Kn5ttHMMaNZhRZbCjvGrDQyDyZgqaR9vBM`  |
| TSLAx | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | `XhM8atXDua58KZnZFLu5vJjzaNWjXaEvpPPEVnHn1ax`  |
| CRCLx | `XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1` | `5X9x9v77jBh2HjTZ1bGY2jtzF5e4ZzfeRzdH3BNKzYfB` |

Observed extensions: MetadataPointer, PermanentDelegate, DefaultAccountState, ScaledUiAmountConfig, PausableConfig, ConfidentialTransferMint, TransferHook, TokenMetadata. The transfer-hook program is currently the zero/default public key; an extension's presence does not mean an active hook executes today. Recheck mutable extension state before supporting a trade.

[Meteora’s quote-mint validation](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/f552f20aa3c1c7631427c3827aeea7c58b902813/programs/dynamic-bonding-curve/src/utils/token.rs) permits plain SPL and metadata-only Token-2022 quote mints by default, and requires a valid token badge for other extensions. The issuer mints have those badges. This resolves DBC approval, but does not prove the entire launch, migration, price and trading integration is complete.

Stock pairs remain disabled in the application until scaled UI amounts are handled consistently in input parsing, displayed balances, price references, candles and fee claims; mutable pause/freeze/hook checks and DAMM graduation must also be verified. No mainnet stock purchases or launches have been performed. The catalog cannot enable these by merely setting a config environment variable.

[Circle mainnet USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses) is `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, six decimals. SOL remains wrapped-native `So11111111111111111111111111111111111111112`.

## Owner setup

1. Configure `ONEONLY_FEE_WALLET` with the owner's public Solana address. Never copy the devnet test wallet's private key into a mainnet deployment.
2. Open `/app/setup`, connect that wallet, and review the SOL and USDC configuration transactions. They charge account rent and transaction fees in real SOL. No transaction is sent without the owner's wallet signature.
3. After confirmation, verify the shown configuration addresses on-chain and set `DBC_CONFIG_SOL` and `DBC_CONFIG_USDC` in the mainnet deployment. The app verifies both feeClaimer and leftoverReceiver against `ONEONLY_FEE_WALLET`, as well as token supply, quote mint, fee economics and migration options.
4. Run `pnpm check:launch --mainnet` with the mainnet environment. A nonzero result reflects unfinished requirements, including stock integrations. Complete low-value wallet-signed mainnet launch, buy, sell, migration and fee-claim checks before declaring trading fully verified.

Existing economics carried forward: one-billion fixed supply, six base decimals, 1.25% curve fee (0.25% protocol, 0.5% creator, 0.5% platform), graduation at 85 SOL or 10,000 USDC, DAMM v2 custom fixed 1.25% fee (no dynamic surcharge), permanently locked liquidity split 50/50 creator/platform. Both phases now use a 1.25% trading fee; existing devnet configurations retain their prior fixed 1% migration option.

## Network boundaries and checks

- RPC genesis checks use the full mainnet hash `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`, not the shortened CAIP reference. The existing Jupiter reference RPC comparison was corrected to the full hash.
- The server passes the selected network to the wallet UI. Wallet Standard signs `solana:mainnet`; explorer URLs omit the devnet query. The reviewed transaction network must match the page.
- Wallet session cookies and resumable intent storage are network-specific. Token and intent queries remain network-filtered. Mainnet database access fails if the dedicated mainnet URL is absent or points at another database name.
- Devnet smoke tests check the app's network before signing. Direct SDK test scripts retain an explicit devnet-only guard.
- Regression verification: 29 unit tests, 20 desktop/mobile regression checks, 2 read-only mainnet desktop/mobile checks, typecheck and production build passed.
- `MAINNET_CHECK_URL=http://localhost:3001 pnpm exec playwright test --config=playwright.mainnet.config.ts` runs the read-only mainnet checks. It does not sign transactions or spend funds.

Still required for a complete launch: full stock adapters and lifecycle tests; Jupiter routing for SOL-to-other-quote buys/sells; production pricing credentials and suitable RPC capacity. No mainnet spending key is held by the app.

## Deployment record

Mainnet deployment: `dpl_EVxgVREGLK5ncUHbDiMqMMqQaYmq` (`https://oneonly-d3d9me9c6-kade.vercel.app`), served at `https://app.oneonly.lol`. Staging directory: `/var/folders/sr/8xkg5bfd4w515h716kr_pkcr0000gn/T/oneonly-app-sdeRvh`. The preceding mainnet build was `dpl_9NNfh4fDq4mwzU2vWiL8AbUuFagj`.

Vercel's mainnet health endpoint returned `{network: "mainnet-beta", rpcVerified: true}`. Read-only Vercel logs confirmed a scheduled `/api/launchpad/cron` request returned HTTP 200 on the mainnet deployment at Unix milliseconds `1789297817315`. A proposed manual cron invocation was rejected by automatic approval review, so no local cron credential was sent; the existing scheduled run was checked through logs instead.

The owner fee wallet is `9rHYpiomWrMNhMb76BabYWzCVMYudBXqhHuQqJBRMrcR`. SOL configuration: `6nqV88X3NKpvZ7wa3uqARiVkVUjJz94JPWaXNLFomryh`; USDC configuration: `FP1MtrDiSfeoCoAtNbjYRGtEpcWLCbkcs9B2RPaj3ddo`. Both owner-signed transactions are finalized and both accounts passed `configuredPool` validation on mainnet. The owner spent 0.01196816 SOL total on the two configurations. No mainnet launch, trade, or graduation transaction has been tested. Stock pair gates remain closed. The test-only devnet release is still available as immutable deployment `dpl_4g2wfNKVfQd72YxzciN6U8vCPR37`; its database has not been deleted or migrated into mainnet.

## Owner configuration verification (2026-09-13)

The supplied owner wallet was verified as an on-curve, system-owned mainnet account with 0.029616243 SOL. Unsigned mainnet simulations of SOL and USDC config creation both succeeded; decoded simulated accounts confirm that wallet as fee receiver and the custom 125 bps graduated fee. Each simulation required 5,974,080 lamports of rent and an estimated 10,000-lamport transaction fee: 0.01196816 SOL total for both. These simulations did not broadcast transactions or spend funds. Evidence is in `.data/mainnet/owner-setup-simulation.json` (local, ignored). The owner subsequently signed both configurations, and on-chain validation passed. Confirmed accounts are recorded in `.data/mainnet/confirmed-owner-configs.json`.

## Stock owner setup

Owner setup now prepares all five stock configurations while stock launch/trading gates remain closed. Each preparation rechecks the mint's Token-2022 program, eight decimals, supported extensions, current pause/default-frozen/transfer-hook state, and separate DBC and DAMM v2 token badges. The current scaled UI multiplier appears in the transaction review; configuration thresholds are denominated in unscaled raw token units. Issuer freeze, permanent delegate, pause and scaling authorities remain.

Proposed fixed graduation quantities for owner review: SPYx 14, QQQx 15, NVDAx 47, TSLAx 28, CRCLx 112 unscaled tokens. These were rounded near the existing $10k USDC threshold using [DEX Screener API](https://docs.dexscreener.com/api/reference) spot references captured on 2026-09-13. This is an approximate setup reference, not a trading oracle or a USD peg. Prices and display multipliers can change.

All five unsigned mainnet config simulations passed with their actual badges, 8-decimal thresholds and custom 125 bps graduated fees. Each used 5,974,080 lamports of rent plus a 10,000-lamport fee estimate, totaling 0.0299204 SOL for five. The agent did not sign or broadcast stock configurations. The owner has now signed all five, and their transactions are finalized. Public local simulation evidence: `.data/mainnet/stock-setup-simulation.json`; recorded mint/badge fixture: `packages/protocol/src/fixtures/mainnet-spyx-setup.json`. Tests reject forged/missing badges, paused or frozen mints, and active transfer hooks; they also check effective display scaling and exact threshold units.

All seven owner configurations are now complete. The last checked remaining mainnet balance after stock setup was 0.009428807 SOL. This does not complete stock trading integration, historical USD valuation, routing, or full launch/migration/claim verification.

## Finalized stock configurations

All five accounts were checked against the actual reviewed curve, quote mint, owner, immutable supply, 125 bps fees, fixed threshold, permanent 50/50 liquidity split, and current DBC/DAMM token badges. These are configuration confirmations, not launch or trading tests.

| Stock | Configuration                                  | Finalized transaction                                                                                                               |
| ----- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| CRCLX | `F4tQZxYp6TyRUPXkM6hJDjYJA4A4FShgizu6KBP2bk5h` | [Explorer](https://explorer.solana.com/tx/3CidBS2pHikmAkvVx6ZMSk5pu1K7iYYCzn6HmvVkNbuig9PcG1qnoUZ578rVHNpAxBjQ5gKqFxQV12XFg3CZYddU) |
| TSLAX | `EDUCUTGAerhJZxMfzHCqaNnYpykESb7nRCBCw7yKHFJQ` | [Explorer](https://explorer.solana.com/tx/4UkfdzofMuThocecsfFjCQwduu9bSZMeRsGj9LhySynGs7nFLNTZnKeNbFwCJBgT5DHEqUk564bjDSktEpxdDkrf) |
| NVDAX | `DBxZBaL45UZeUjoeo5BejMqUmLZjz72Nf3miCz3fPe3G` | [Explorer](https://explorer.solana.com/tx/y2A3JhdSY8ShAefdWLDCgmarcBA1BEZrQnzkKzFTJba8Bkr8mhRns9pXh1Rrq6jSKh3qwT43mDrDj9Wpnqx4tQ2)  |
| QQQX  | `2VuZwBXV7TfKGyoYJq96LUM5wZZSvhvPQD9yq72aUZb3` | [Explorer](https://explorer.solana.com/tx/3gbaV619WFGGyBTgGct3wooTvA6h7Qrv341dp72BssXyPLM6uiHs81gtXR3k5dndKo4YrzqwEsCE99zX7kyuBwDn) |
| SPYX  | `CxSrehSfRFrzeBoq7NbVQiwfXcy35wAmr4QyoJfRXCcT` | [Explorer](https://explorer.solana.com/tx/4NzFszwtC3EEKaU1oYG1g9faxDQt388TMDzAuQH8w3bD8isHeQ342W1dcywNQcPpsAXAmxWGKLL65cG3Gkt5kTFU) |

Verified public record: `.data/mainnet/confirmed-stock-configs.json`. Production stores these under their respective `DBC_CONFIG_` variables. The stock trading gate remains closed until the remaining adapters and lifecycle tests are complete.

## Production readiness review

The early-access sidebar promo was removed from the app only. Mainnet health is verified, all seven owner configurations are installed, and SOL/USDC pairs are enabled. All five stock pairs remain disabled, and the live price response contains only SOL and USDC. This is not yet a complete production launch: stock scaled-balance/trading integration and historical USD pricing, cross-asset swap routing, and owner-signed mainnet end-to-end launch/buy/sell/graduation/fee-claim verification remain outstanding. Production pricing credentials and RPC capacity also need completion/verification. Existing devnet lifecycle tests and passing UI/build checks do not establish mainnet financial correctness.

## Testing constraints and access update

The owner requested no mainnet spending for testing. Use static review, unsigned RPC simulations, and local execution with cloned public accounts/programs; do not submit funded mainnet test transactions. Documentation review alone does not establish runtime correctness.

Jupiter keyless Price v3 was verified on 2026-09-13: HTTP 200 with prices for all five stock mints, including scaledUiConfig and usdPricePrescaled where applicable. The current application still incorrectly gates these requests on JUPITER_API_KEY; that gate must be updated before claiming keyless prices are integrated. No API key or paid RPC is required to continue development. A provider-issued mainnet RPC endpoint and a free Jupiter API key remain appropriate production configuration, with capacity assessed separately. Official Jupiter portal docs now document keyless access at 0.5 RPS and a free API key tier at 1 RPS: https://developers.jup.ag/docs/portal/setup . The earlier multi-day ETA was not based on a measured implementation pass and was withdrawn.

## Stock adapter implementation pass (local, not deployed)

Implemented exact integer conversion between displayed stock input and raw token atoms, truncating spends and minimum-output displays. Stock mint preparation now rechecks both badges and mutable pause/freeze/hook state. Jupiter pricing now supports keyless requests, coalesces concurrent refreshes, and validates decimals, on-chain effective scaling and prescaled USD units; server accounting remains raw. Portfolio balances, token details and chart presentation use the current display scale. Charts explicitly identify adjusted history. Graduated quote reserve storage now reads raw RPC amount, avoiding mixed scaled/raw accounting.

The first pass passed 36 unit tests and typecheck. Display/API changes subsequently passed typecheck; final additional regression test is in progress. Stock gates remain closed. This pass does not yet implement cross-asset routing or historical stock USD coverage and is not a production readiness claim.

Prepared public mint/config/badge fixtures and a localhost-only lifecycle harness. No local validator has been started and no ledger exists. User raised limited disk space and old-validator concerns: installed validator reports 3.1.14, available disk about 25 GiB, fixtures 112 KiB. Prefer an in-memory runtime after checking footprint/compatibility; do not upgrade/start a large validator as a routine next step. No mainnet test spending.

### In-memory lifecycle results

All five stocks passed the local LiteSVM 1.4.1 lifecycle against copied deployed mainnet DBC, DAMM v2, Metaplex and Token-2022 programs, signed stock configurations, mints and badges: launch/first buy, curve sell, fill curve, curve creator fee claim, migration, DAMM buy/sell and graduated creator fee claim. Tests caught and fixed a missing stock token badge in createPoolWithFirstBuy. The fixture also needed the actual public DBC flash-rent authority account; test-only compute-budget duplication was fixed. No public transaction broadcast is possible in the in-memory facade, which throws on unimplemented RPC methods instead of falling back to a network.

Evidence: `.data/mainnet-fork/results.json` and program SHA256/deployment-slot manifest `.data/mainnet-fork/programs/manifest.json`. Test command: `node --import ./packages/db/node_modules/tsx/dist/loader.mjs scripts/smoke-mainnet-fork.ts`. This is protocol lifecycle execution with synthetic balances, not a complete browser/app-server or live Jupiter-route end-to-end test. All 37 unit tests and app typechecking passed before the last badge change; recheck after remaining implementation. No validator or ledger was started. Native LiteSVM package is about 9.2 MiB; public program binaries total roughly 6.4 MiB. Stock trading remains gated pending app/routing/history completion.

### Waitlist aggregate (2026-09-13 13:29 UTC)

Production landing database read-only aggregate: 71 distinct saved wallet addresses, 42 distinct connected X IDs, 113 signup rows total, 95 rows in the prior 24 hours. Rows are separate wallet/X entries and do not establish distinct people. Obtained using only the landing project's identified DATABASE_URL in memory; no full environment download, credential file, or individual signup export. Earlier broad environment pull was automatically rejected; this narrower method succeeded. Delivered results visibly to the user.

### Routed trading implementation (local, not deployed)

Added Jupiter v2 unsigned route preparation with keyless support, strict RouteV2 amount/slippage/mint/signing-wallet/destination checks, zero integrator/positive-slippage fees, constrained wallet-owned ATA setup and bounded native wrapping. Actual on-chain lookup tables are fetched instead of trusting provider address arrays. Versioned transaction support now preserves exact-message comparisons and verifies every Ed25519 signature before submission. Trade UI chooses SOL or the quote asset; server composes conversion + Meteora swap atomically, divides slippage between legs, shows minimum output and retained quote remainder, checks packet size, and simulates before wallet review. New tests bring the suite to 40 passing; typecheck passed.

Read-only Jupiter build returned an unsigned SOL→SPYX route without a key. The copied route was executed successfully in LiteSVM, then composed with a new stock-paired DBC pool buy: 0.1 artificial SOL input, base output 2754938923616 atoms >= reviewed minimum 2741164228997, 6428 stock atoms left in wallet, 1027-byte transaction. Fixture timing must use its captured chain slot and timestamp; using wall clock with old oracle accounts correctly fails PriceExpired. Evidence `.data/mainnet-fork/jupiter-result.json`. Reverse routed sell test is in progress. Full application/browser tests and production deployment are still pending. Do not report the full app ready.

### Released implementation and verified limits (2026-09-13)

This update supersedes the pending implementation/deployment notes above. The stock adapter, current scaled pricing, versioned transaction verification and atomic SOL settlement are deployed to https://app.oneonly.lol from `dpl_GSJ3g3xZjJ7Pg7ewdFSw7qXuiqw6` (`https://oneonly-3axigi960-kade.vercel.app`). All seven configurations and current USD references passed candidate checks. The non-secret `ONEONLY_STOCKS_ENABLED=true` flag is persisted in Kade/oneonly-app production. The early-access landing deployment was not changed.

Validation: 42 unit tests, full workspace typecheck and production build passed. Ten local compiled-app browser regressions passed across desktop/mobile with isolated PGlite. Four published read-only checks passed across desktop/mobile: configuration/network/setup authorization plus stock/SOL settlement controls and absence of the early-access sidebar link. The first settlement test used a mismatching exact label locator; using the confirmed accessible combobox name passed without an application change.

All five stock protocol lifecycles passed in LiteSVM with copied public mainnet programs/configurations and artificial balances. Both atomic SOL→SPYX→base and base→SPYX→SOL directions passed, with reverse evidence in `.data/mainnet-fork/jupiter-reverse-result.json`. The successful captured routing test used Kipseli/Riptide venues; it is not exhaustive coverage of every possible Jupiter route. Application preparation simulates each constructed route before review. No real mainnet test transactions were signed or broadcast, and no validator ledger was started.

Historical stock USD valuation now requires the exact stock mint, USDC quote, a liquid matching pool and an exact completed minute candle. Raw-unit accounting uses the minute high, conservatively estimating volume for ticker inactivity. Partial candles and provider failures remain unknown. The indexer retries a bounded sample of recent missing prices before release evaluation. Live reads returned valid SPYX and QQQX candles; additional requests encountered HTTP 429 limits, so complete historical coverage for all five stocks is not established. Missing volume continues to prevent ticker release.

The implementation is released; this is not a blanket production-readiness certification. Free provider throughput and historical coverage remain observed operational limits. A provider-issued RPC endpoint/Jupiter key and dependable historical-data capacity should be assessed for the expected launch traffic. No paid access is required for the tests already completed. Original broader product-brief features beyond these launch/trade flows should be checked separately before claiming the entire brief is complete.

### Discovery empty-state correction (2026-09-13)

The stock discovery category incorrectly equated an empty token list with missing quote configuration. Removed its hardcoded “coming” and “not configured” messages. Empty Stocks results now say “No stock-paired tokens yet” and offer a launch link; text searches show “No matching tokens.” The Tokens category likewise describes missing listings without inferring configuration state. Published to app.oneonly.lol as `dpl_BCJWeXfib5KmacbngQBXdkwuTGCK` (`https://oneonly-7zyk87v6o-kade.vercel.app`). Production build/typecheck passed; this is a discovery-copy correction and does not change trading configuration.

### Launch review incident fixed (2026-09-15)

Production logs showed repeated launch HTTP 503 responses caused by reading `staticAccountKeys` on an undefined message. The externalized Meteora SDK produced a legacy transaction with a different web3 constructor identity from the bundled app, so `instanceof Transaction` incorrectly selected the versioned path. Legacy detection now uses the transaction API rather than constructor identity throughout preparation, message comparison, signature verification and submission. A shared preparation helper applies the fee payer/blockhash, preserves ephemeral mint signatures, and enforces the packet limit. A regression uses a distinct prototype to reproduce the deployed boundary and checks both unsigned payer and valid mint signatures; versioned signer/message checks remain intact.

All 43 unit tests, workspace typecheck and both candidate production builds passed. Deployed API checks signed only login messages with generated unfunded wallets, uploaded a test image and requested launch review. SOL (988 bytes), USDC (959 bytes), and SPYX (1024 bytes) returned valid prepared transactions with unsigned fee payers and valid mint signatures. No wallet transaction was signed or broadcast. The expiring off-chain QA drafts are handled by normal intent reconciliation and never appear as active launches. The first grouped SPYX request hit an upstream RPC HTTP 429; a separate retry passed. This is a distinct public RPC capacity limitation, now reported with a specific busy message and Retry-After header instead of the generic connection error.

The wallet button is rendered on the client to avoid remembered extension state conflicting with SSR. Published desktop/mobile tests with a registered, already-connected remembered test wallet passed without page errors. The screenshot's separate `evmAsk.js` Ethereum injection error was not reproduced or modified by this fix.

Final deployed app: `dpl_vCXGjFrRUftJGdJgiMXPASFgL5LW`, https://oneonly-c7g2tye2g-kade.vercel.app, promoted to https://app.oneonly.lol. Landing deployment unchanged. Reusable no-broadcast endpoint regression: `scripts/check-launch-review.mjs`; it explicitly disallows the submit endpoint and removes temporary cookies/request files on exit.

### September 15: Phantom signing and launch UX

Phantom's documented priority-fee insertion could change unsigned trade messages. Preparation now installs explicit compute limit/price instructions before storing the reviewed message; wallet-returned bytes are preserved and any message mutation is still rejected. Reviewed priority fees are displayed. A live GIDDY review was signed locally with an unfunded generated key and verified (726 bytes, one signer, 0.0000014 SOL priority fee); nothing was broadcast. Desktop/mobile mocked-wallet checks cover unchanged and amended messages.

The latest app update adds SOL-funded non-SOL launches as **two separately approved transactions**. Step one uses the validated Jupiter v2 route to convert SOL; its minimum output must cover the $5 first-buy requirement. After confirmation, the user explicitly continues to mint creation/first buy. The server stores the exact conservative raw quote amount, splits the selected slippage between the two steps, revalidates pricing/configuration, and resumes from transaction history after a reload. There is no atomicity between these two transactions: stopping, a changed price, or a ticker being claimed leaves the converted asset in the user's wallet. Native quote-asset payment remains available. Existing buy/sell SOL routing is unchanged.

Decimal commas are normalized before integer conversion, invalid amounts never render NaN, and ticker focus surrounds the prefix and input together. Discovery uses the requested headline, interactive peeing character, All/SOL filters, and keyboard search focus. Compact laptop layout and mobile list presentation replace the large hero/card layout. The project pool/links item was explicitly removed from scope.

Trader comments require wallet authentication and a finalized **One Only** launch/buy receipt matching the server's reviewed message, a canonical Meteora buy event for the token's pool, and a positive base-token balance delta owned by that wallet. Transfers alone do not qualify. Historical verified buyers retain eligibility after selling. Comments are plain text, limited to 500 characters, rate limited, paginated with a stable cursor, and removable only by their author. Purchases made entirely outside One Only are not currently discovered for this gate.

Migration `0006_mighty_wendell_rand.sql` was applied successfully to `oneonly_mainnet` within the existing Vercel build environment; the database credential was not exported. It adds comments, buyer proofs, and nullable continuation fields without changing existing records. Testing includes 52 unit/integration tests across the suite and new browser checks for form amounts/focus, comments, conversion resumption and compact discovery. No mainnet funds were spent. These checks do not establish a funded end-to-end mainnet conversion/launch result; public RPC and route availability remain runtime dependencies.

Final release: `dpl_DopZwJ6hMbhdobXFZUGAHzRFTRSn` (`https://oneonly-fo36u39m5-kade.vercel.app`), aliased to `https://app.oneonly.lol`. Final validation: 52 unit/integration tests, full typecheck/build, 8 published desktop/mobile improvement checks; the 4 Phantom signing regression cases also passed. Public comment reads return 200 and unauthenticated posting returns 401. The first full desktop token row fits 1280×720; mobile uses a single-column list. Landing deployment was not changed.

### Line charts and readable values — September 15, 2026

Token charts now use a TradingView area series: a green line with subtle fill,
closing execution prices for each selected interval, volume bars, and an exact
OHLC data table. The change percentage compares the selected/latest close with
the first displayed close; interval buttons select aggregation size, not a
promised historical return period. Single-point/flat series use a padded price
axis without inventing trades.

Display amounts use K/M/B and four significant digits for sub-unit values,
without scientific notation or rounding a positive tiny price to zero. Signed
transaction review amounts retain every decimal with digit grouping. UTC price
reference times are human-readable. Stock reference reads now inherit the
configured mainnet SOLANA_RPC_URL unless MAINNET_PRICE_RPC_URL explicitly
separates that traffic; devnet still uses a mainnet reference source.

Validation: 55 unit/integration tests, workspace type checks, production build,
and six desktop/mobile chart and mocked wallet-signature checks passed. Mainnet
health returned rpcVerified=true after the user's RPC redeployment. No funded
mainnet test transactions were sent. Provider outages and separate price/router
rate limits can still affect availability.

### Multi-asset swap panel — September 15, 2026

Token pages now provide payment/receive asset selectors, exact balance percentage
shortcuts, Max, and a direction switch. The selected token mint remains fixed;
choosing another settlement asset converts through the token's registered curve
or graduated pool. This does not create additional pools or merge historical
mints that reused a ticker. The executable output is quoted on review.

Routing accepts the platform's supported asset allowlist. A non-native settlement
asset is composed with the pool swap into one versioned transaction, validated
against Jupiter's RouteV2 instruction and wallet account constraints, and must
simulate successfully before a review intent is prepared. Intermediate WSOL is
funded by the preceding swap, without duplicate native funding or early account
closure. Issuer multipliers apply to stock input/output amounts. Conversion
residuals stay with the wallet; SOL fees and token account rent remain additional.

Balance reads use the server RPC and both SPL token programs. Unknown balances
stay unknown. Percentage inputs use integer arithmetic, round down, and reserve
0.01 SOL when SOL is the input. This reserve is an allowance, not a guaranteed
fee estimate. Market availability remains dependent on router liquidity, RPC,
packet size, compute limits, balances, and the live simulation. No funded
mainnet test transactions were sent for this release.

### Custom selects and collapsible panels — September 15, 2026

Creation and trading now share themed custom selects. Asset menus include full
names, search, known balances, keyboard navigation, and selected-state indicators.
Menus remain anchored during scrolling and resizing and fit the mobile viewport.
The navigation can collapse to a desktop icon rail or hide the mobile bottom bar;
the trading sidebar can be hidden to expand the chart. Both preferences persist
locally, and hiding the trade panel keeps its form state mounted.

Validation: workspace type checks and the production build passed. Fourteen
Playwright desktop/mobile checks passed against the deployed app, using mocked
API/wallet flows, including search, keyboard selection, resize handling, collapse
persistence, form preservation, and unchanged signature safeguards. Desktop and
mobile screenshots were inspected. No mainnet funds were spent. Published to
app.oneonly.lol as dpl_3tYWY5zYzQf5Z2oTGg9tST2RsRKq.

### Asset logos and focus styling — September 15, 2026

SOL/USDC registry logos and the five issuer-provided xStock logos are bundled in
public/token-icons (source URLs recorded in sources.json), and shown in selector
triggers and menus. Letter placeholders were removed. Focus uses subtle surface
color/brightness changes instead of outlines on both the app and landing site.
Only the left navigation can collapse; the trading panel always stays visible,
including for browsers with a previously saved collapsed trading-panel setting.

Workspace type checks, both production builds, 14 app desktop/mobile checks and
2 landing scene checks passed. All seven deployed logo endpoints returned WebP
successfully. App deployment: dpl_BwkmSCMdap2ENyBJBHLgNaBmVVDC; landing deployment:
dpl_3xKdwrGjUvBVbBhgN8BpJGyDYosX. No mainnet spending was involved.

### Live receive previews — September 15, 2026

The receive card now uses @number-flow/react and requests a numerical preview
after 350ms without input changes, refreshing every 15 seconds while visible.
Requests are aborted/ignored on edits; previous values are dimmed while updating
and cleared for invalid input, route errors, or a changed asset/direction. Partial
decimal separators remain stable. Reduced-motion preferences are respected.

GET trade-preview/:id works without authentication and returns no transaction or
intent. Direct quotes use Meteora quoteSwap; conversion previews share the exact
routed quote calculation with reviews (including conservative intermediate limits
and issuer scaling). Jupiter requires a taker for build quotes, so previews use a
disposable unfunded public address whose private key is discarded. The executable
review still builds a fresh wallet-specific transaction with its existing checks.
Preview availability does not prove a funded transaction will execute.

Validation: 64 unit/integration tests, type checks, production build, and 16
mocked desktop/mobile UI checks passed. Live GIDDY quote-only requests returned
200 for 0.01 SOL and 89 USDC; no signing or mainnet spending occurred. Deployment:
dpl_2kq6iDtm23pkEkVz8yhFebApCdUz on app.oneonly.lol.

### Tablet trade layout and concise copy — September 15, 2026

At widths up to 850px the chart is followed by a full-width trade panel, then
story and recent trades. The graduation card stacks below the form. Unknown
balances no longer display an em-dash availability label or unusable Max and
percentage buttons; confirmed zero balances still display correctly. Removed
redundant trade/gradation guidance and the chart execution-method paragraph,
while retaining trade errors, fee information, quote status and chart attribution.

Type checks/build and 16 desktop/mobile regression checks passed. Additional
checks at the annotated 666px width and on mobile confirm the form matches chart
width, precedes history, and leaves space above slippage without balance controls.
Final spacing checks passed on dpl_DxaXsr7MTde9no4XHWyhh4xAajJc, app.oneonly.lol.

## Confirmation feedback and wallet fee review (2026-09-15)

Confirmed transactions now close the review and show a dismissible success toast with an explorer link; the SOL-to-quote conversion retains its second-step launch flow. Trade balances refresh on confirmation. Quotes show an animated placeholder/spinner immediately, preserve a dimmed earlier quote while updating, and offer retry after failure.

A wallet-adjusted compute budget is never broadcast against the previous review. A new authenticated fee-review endpoint verifies all signatures, requires the exact same blockhash, account permissions, lookup tables and non-budget instructions, bounds compute units to 1.4M and priority fees to 0.0001 SOL, discards the received signatures, and atomically replaces the still-prepared review. The updated fee needs another user approval. Ordinary submit continues to require the exact reviewed bytes and valid signatures. Mutation tests cover trade amounts, blockhashes and excessive fees; browser fixtures cover immediate and polled confirmation and two approvals for a fee revision. No mainnet test spending.

The comment composer is visible immediately, supports Cmd/Ctrl+Enter, preserves drafts through wallet connection/X linking, and verifies purchases server-side during posting. Optional X profile linking is implemented behind X_LINK_SECRET. It reuses the landing site's existing OAuth callback, issues a signed, short-lived handoff bound to a wallet and browser nonce, and checks the app wallet session before saving a unique X identity. Only X-hosted profile images are rendered. Historical comments resolve the linked profile; unlinked wallets retain wallet labels. It does not merge unrelated waitlist signups or add app links to marketing counts.

X activation is disabled at the user’s request (they selected “Keep X linking disabled”): additive migration 0007 creates wallet_profiles in oneonly_mainnet, and a shared X_LINK_SECRET must be installed in the app and landing Vercel projects. Automatic approval review rejected those production database/settings changes. The user subsequently chose to leave X linking disabled. No such migration or secret setup was executed. Without the setting, existing comments continue working without querying the new table, and Link X is hidden. The landing callback changes must also be deployed when X linking is enabled.

Published app deployment: dpl_AZE83LqCRSx1EmrNjGjR4G4NZtHW, aliased app.oneonly.lol. All 18 mocked desktop/mobile regression cases passed, followed by two targeted composer posting/keyboard-shortcut checks with a mock buyer. Live read-only checks returned 200 for comments and profile (X available=false); GIDDY sell preview for 1,837,065.8983 tokens returned a numerical quote in 862ms. These are not funded Phantom execution tests. User selected “Keep X linking disabled”; neither the production migration nor shared secret setup ran, and the landing callback release was not deployed.

### 2026-09-16 — Token search overlay

Published app-only deployment `dpl_8FUFV3dLb5Sw6Q6uKx8y4HqPdgkT` (`oneonly-3jgbz481s-kade.vercel.app`). Explore search opens a native modal with live name/ticker/contract lookup, exact-match relevance, market-cap/volume/newest/oldest sorting, 24h/7d age filters, SOL/USDC/individual stock pairs, pagination, and keyboard navigation. Stocks shortcut opens filtered search. Queries are debounced, aborted on change/close, and stale results cannot be selected. No schema, credentials, pool configurations, or trading changes.

Validation: typecheck and production build passed; six PGlite market-query tests and four desktop/mobile search/discovery browser tests passed. Used installed Chrome through optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to avoid downloading another browser. Production GIDDY lookup returned its matching listing. Mobile visual inspection checked the nested stock selector and overlay width. X linking remains disabled.

## Topbar, default dark mode, and X activation — 2026-09-16

Published app `dpl_4WETvBUiprHSVsVGcqptSUcEZXVZ` (`oneonly-p5znmey8f-kade.vercel.app`) at app.oneonly.lol and OAuth callback support in landing `dpl_HoUMXYMZ7qVVBP9fmZQzc2AqCeqm` (`oneonly-g1wvsj10d-kade.vercel.app`) at oneonly.lol. Sidebar toggle is centered on its upper-right boundary on desktop and the top boundary of the mobile navigation; it stays reachable when collapsed. Dark mode is the app default, with a server-read preference cookie, an explicit light/dark toggle, themed charts, selects, dialogs, wallet chooser, forms and comments. Landing artwork retains its existing appearance.

The user's new Connect X request supersedes the earlier disabled-X decision. Additive migration 0007 was validated on a copy of main (`br-raspy-sound-awgpo9zm`, `codex-x-profile-check-20260916`) before production: existing token/trade/comment counts were preserved and the unique X identity constraint rejected duplicates. The temporary branch auto-expires 2026-09-17. Migration 0007 is now applied in oneonly_mainnet. X_LINK_SECRET is configured in both production projects; credentials were not printed or downloaded as a full environment.

Topbar Connect X authenticates the wallet, supports Explore as well as token-page return destinations, and displays a verified X username/avatar linking to the profile. Existing comments resolve linked profiles. Handoff assertions retain HMAC, expiry, purpose, browser nonce and wallet checks. The normal wallet cookie remains SameSite=Strict. A ten-minute HttpOnly callback-only cookie references the same revocable session for cross-site OAuth redirects; it is cleared on return. A conflicting current wallet or revoked session cannot link. No X access token is persisted.

Validation: typecheck and production builds passed; 16 desktop/mobile browser cases covered theme persistence, sidebar controls, search, trading previews, X entry/identity and wallet confirmation/fee rereview. Six X security/callback unit tests and six market tests passed. `node scripts/check-x-link.mjs` passed against production: ephemeral-wallet off-chain authentication, authenticated profile read, shared-secret handoff to X with S256 PKCE, callback-scoped session cookie, forged assertion rejection, and original waitlist OAuth. The temporary session was logged out. Real X consent was not performed; the user authorizes their own account through Connect X. No mainnet transaction was sent and no marketing signup/profile was fabricated.

### Trade page section order — September 16, 2026

Published app deployment `dpl_E4a5QWkLQcKWpEYZ6jWabAsCMhkm` to `app.oneonly.lol`. Story now spans the first content row, chart and trading controls occupy the second, comments span the third, and recent trades appear last. Mobile stacks chart and trading controls within the second section. Existing graduation and creator-fee controls remain with the trading panel.

Validation: workspace typecheck, production build, and both desktop/mobile trade-preview browser checks passed. Read-only checks on the published OneCat page confirmed section order, full-width rows, and no horizontal overflow at 1440px, 666px, and 390px. No blockchain transactions were submitted.

### Confirmed-purchase sharing — September 16, 2026

Published app deployment `dpl_CY6ZXiDUe9cVz87Gq17uQNvKo6Zu` (`https://oneonly-533h5eywi-kade.vercel.app`) to `app.oneonly.lol`. Confirmed buy intents close the transaction review and open a dismissible share dialog; sells retain their success toast. Direct and routed trade intents now include the token ticker for the share caption. The supplied `IMG_8218.JPG` is optimized into an 88KB background; the generated image places the token's actual ticker in the puddle using the existing marker typeface.

`/app/share/[id]` provides a public token-linked share page and X large-image metadata. Its image endpoint renders the original composition for popup/download, or a 1200×630 card that preserves the whole scene. Images are keyed by token ID so recycled ticker names cannot point shares at a different token. Share on X opens a prefilled user-controlled draft with the share-page URL; Save image downloads the rendered PNG. No purchase amount, wallet identity, or private receipt is published in the image.

Validation: workspace typecheck and production build passed; image rendering covered short and ten-character tickers. Eight desktop/mobile mocked-wallet checks covered immediate and polled buy confirmations, wallet fee re-review, dismissal, and absence of the share popup on sells. Read-only production checks verified Twitterbot metadata, 1200×630 card, 1200×1018 download with filename, and responsive share-page layout at 1440px and 390px. No mainnet transaction or X post was submitted; X's final rendering remains controlled by X.

### Confirmed-sale artwork — September 16, 2026

Published app deployment `dpl_4fjahgusLFhvmUXxEkUAtQz6A1fn` (`https://oneonly-lee5yk3vv-kade.vercel.app`) to `app.oneonly.lol`. Confirmed sells now open the supplied `Untitled_Artwork.jpg` scene with a Sale confirmed heading and the token ticker in the dialog title. The original artwork is preserved without adding a ticker overlay. Share on X uses a sell caption and `?side=sell` share URL; preview, download filename, and metadata use the sell variant. Buy artwork and captions remain available through the default variant.

Validation: typecheck, production build, two image-rendering checks, and all eight desktop/mobile mocked-wallet confirmation checks passed. Read-only production checks verified the sell share metadata, 1200×630 card, 1200×1018 download, and desktop/mobile share-page layout. No mainnet transactions or X posts were submitted.

### JUP and MET pairs — September 16, 2026

Published app `dpl_HyHY37Hb35P5ae3GgtSNMe4ZkwN6` (`https://oneonly-8x09ddkmq-kade.vercel.app`) to app.oneonly.lol. Official JUP and MET mints are now built-in mainnet token assets, with six-decimal accounting, issuer logos, Jupiter prices, trade payment/receive choices, and individual discovery filters. Historical valuation uses the existing mint-verified USDC candle path; missing history remains unknown. Sources: Jupiter's genesis post (`https://discuss.jup.ag/t/jup-the-genesis-post/478`) and Meteora's official Buy MET link (`https://ir.meteora.ag/`). Both mint accounts were read on mainnet: classic SPL, six decimals, no mint/freeze authority or extensions.

The owner explicitly chose approximately $10,000 graduation targets. Setup converts the current verified USD reference to a whole-token amount rounded upward, then freezes that quantity in the owner-reviewed configuration. The reviewed amount is not a USD peg. New JUP/MET curves retain the existing one-billion supply, 80/20 supply allocation, 1.25% curve/migrated fee, and 50/50 permanently locked creator/platform LP distribution. Existing configurations were not changed. Owner approval is still required for each new configuration, followed by verifying and installing DBC_CONFIG_JUP and DBC_CONFIG_MET; launches remain disabled until then. Payment/receive routing does not require these new launch configurations.

Production quote checks exposed an unsupported Jupiter SharedAccountsRouteV2 response. Added strict support using Jupiter's on-chain published IDL: byte-level input/output/slippage/fee verification, owner ATAs, Jupiter authority and shared ATAs, event authority and program checks. A captured public quote fixture tests valid shared routing plus tampered accounts, fees and amounts. Ordinary RouteV2 validation also checks event authority and program accounts.

Validation: full pre-routing regression suite (83 tests), desktop/mobile token-search checks, typecheck and production builds passed; after the route change, all eight affected routing/security tests passed. Unsigned mainnet CreateConfig simulations passed for both mints at a representative 50,000-token threshold (36,629 compute units each); no transaction was submitted or SOL spent. Live app prices loaded for both assets, individual filters returned successfully, and all four JUP/MET buy/sell previews returned positive outputs and minimums. Some RPC reads initially returned 503 busy responses and passed on retry; this remains a production reliability limitation. New launch configs are not yet signed/installed, so this does not claim a completed mainnet JUP/MET token launch or graduation.

Published desktop/mobile UI checks also passed for the JUP/MET setup buttons, selector search, loaded MET icon and horizontal overflow. Screenshots are saved in `/tmp/oneonly-live-token-setup-{1440,390}.png` and `/tmp/oneonly-live-token-selector-{1440,390}.png` for this session.

### Optional creator first buy — September 16, 2026

Published app `dpl_74CE5MoAvNBmpHtzfQv3inQWHaaU` (`https://oneonly-35b2djl6b-kade.vercel.app`) at app.oneonly.lol. Creation defaults to no purchase; the creator can expand “Add a first buy” for the existing purchase/conversion flow. Omitted, blank and zero initial buys normalize to no purchase, while negative/malformed values remain rejected. The no-buy backend skips quote conversion, the $5 purchase requirement and USD price lookup, and builds Meteora's standalone createPool transaction. Review explains that there is no purchase and that SOL still pays creation rent and network fees. The optional positive buy retains its minimum, slippage limits and atomic pool creation/buy transaction. Ticker reservation and confirmed-pool activation are unchanged.

Configuration availability now separately reports whether a verified pair can be created, allowing no-buy launches without a current USD reference. Pairs missing a verified configuration remain closed. Existing pool configurations require no changes.

Validation: typecheck, production build, ten relevant core/backend tests and desktop/mobile creation browser tests passed. `scripts/smoke-optional-buy.ts` ran copied mainnet programs entirely in LiteSVM: a no-buy pool had zero creator tokens and zero quote reserves, then a separate wallet paid and signed alone to buy successfully. The existing 0.05 SOL creator-buy path also executed successfully followed by an independent purchase. No mainnet transactions were submitted and no real SOL was spent.

## 2026-09-16 — Retard Office

Added `/app/office` and sidebar/mobile navigation for lifetime platform statistics. Uses network-scoped confirmed active/released launches, actual migration snapshots, and indexed historical trade USD values. Drafts, failed launches, other networks, and future-dated trades are excluded. Coverage gaps and missing historical USD values are explicit.

Revenue reads Meteora DBC lifetime partner fee counters, in native quote-token units. Creator payouts use the SDK's reconstructed claimed creator share (total share minus unclaimed); labelled as an estimate because of per-swap rounding. Migration fees and post-graduation DAMM fees are not included. RPC failures remain unavailable/partial, never a manufactured zero. Fee reads have bounded concurrency/time, and totals are cached for 60 seconds. No production schema changes, wallet signatures, or spending.

Buyback/burn omitted for now at the user's request. No tracking wallet or burn-token source has been configured.

Validation: four aggregation/fee tests and four desktop/mobile browser tests passed, plus typecheck and production build. Mobile dark navigation contrast corrected.

Published app `dpl_DG9jEp9DgAoF4QNirNYXNSa5ncV4` (`https://oneonly-ed0qmhl9p-kade.vercel.app`), aliased to app.oneonly.lol. Live aggregate and fee endpoints returned HTTP 200, all four current pools' fee reads succeeded, and desktop/mobile pages had no runtime errors or horizontal overflow. Live volume coverage is partial; the page labels it accordingly. No mainnet transactions were sent.

## 2026-09-16 — Optional story and project identity

Creation now permits an omitted/blank story (up to 500 characters when present) and optional Website, X, Telegram, and Discord links. HTTPS links are validated and normalized, X accepts profile URLs only, and pasted links cannot grant verification. “Use connected X account” authenticates the creator's wallet and selects its existing OAuth-linked profile; the launch server independently resolves and snapshots that identity, rejecting missing or changed profiles. Editing the X URL or switching wallets removes the selected verification mode. Verified means wallet-linked X identity at launch, not an X subscription or an endorsement.

Migration `0008_cloudy_wasp` adds nullable `launch_tokens.project_links` JSONB. Tested on the existing isolated Neon branch `br-raspy-sound-awgpo9zm`, including JSON roundtrip and unchanged existing token/story digest. Existing tokens remain compatible with null project links. Project links appear on the token detail page and in token metadata (extensions plus the verification snapshot); the website becomes metadata external_url when supplied. Empty stories no longer render an empty story paragraph.

Validation: 17 core/backend/database tests and six desktop/mobile browser tests passed; typecheck and production build passed. No mainnet transaction submissions or SOL spending.

Production migration 0008 completed successfully. Published app `dpl_3cWo8oM5CSjsmTF9UHdNeYYCkizz` (`https://oneonly-2ywty64or-kade.vercel.app`) at app.oneonly.lol. Live desktop/mobile checks confirmed the optional story, all four link fields, connected-X selector, no overflow, and no browser runtime errors. Existing token metadata still returns HTTP 200.

## 2026-09-16 — Trade confirmation sounds

Added distinct short synthesized buy (rising chime) and sell (descending tone) cues to the existing confirmed-intent success handler. A launch that includes an initial purchase gets the buy cue; no-buy launches, fee claims, conversion steps, pending/failed transactions, and repeated notifications do not. Audio is unlocked directly from the wallet approval click, before async wallet work; blocked/unsupported sound does not affect transaction handling. No audio downloads or external service calls.

The topbar speaker toggle defaults on, remembers mute in local storage, and stops any active cue when muted. Compact mobile controls fit at 320px. Tests cover confirmation gating, distinct notes, mute/blocked audio behavior and desktop/mobile preference persistence; typecheck/build passed. No real SOL spent.

Published app `dpl_D4km8TkqUUJa7tuzRwTNFxnzrvaB` (`https://oneonly-rhllmv5b0-kade.vercel.app`), aliased to app.oneonly.lol. Live checks at 1440px and 320px confirmed mute preference persistence, no horizontal overflow, and no browser runtime errors. No trades were submitted.

## 2026-09-16 — Remove Stocks search shortcut

Removed the standalone Stocks button beside Search tokens and its unused styles. Published app `dpl_EVxU9rUi24PygxeFEinjJxrm5VaE` (`https://oneonly-dyq5g1xbl-kade.vercel.app`) at app.oneonly.lol. Typecheck and production build passed. Live checks at 1440px and 390px confirmed the shortcut is absent, search still opens, and there is no horizontal overflow.

## 2026-09-16 — USD market caps and fresh quote pricing

Token detail now returns marketCapUsd and shows it as the primary market-cap metric, with native quote-token value below. Valuation is calculated from raw pool accounting units before stock UI scaling, checks allowlisted quote mint identity, and excludes pre-migration snapshots for graduated pools. Missing USD references remain unknown rather than zero. Existing discovery USD rankings use the same reference service.

Jupiter Price V3 is the primary feed for SOL, USDC, JUP, MET and all five xStocks. SOL/USDC Coinbase spot references are independent fallbacks. Requests are coalesced, the reference cache is 15 seconds, and token detail refreshes every 15 seconds. RPC block-time validation continues to reject Jupiter data older than 120 seconds; scaled stock prices must match the issuer's on-chain multiplier. Provider failures no longer suppress unrelated assets. Documentation checked: https://developers.jup.ag/docs/guides/how-to-get-token-price and https://developers.jup.ag/docs/api-reference/price .

Validation: 13 pricing/accounting/market tests, two desktop/mobile browser cases covering all nine quotes plus missing prices, typecheck, and production build passed. Published `dpl_6SSTq4bzgnHv26Xy3UiPYZz63Mr5` (`https://oneonly-m6390lfg2-kade.vercel.app`) at app.oneonly.lol. Live public config returned valid references for all nine assets; ONECAT displayed $2.61K with 26.56 SOL below on desktop and mobile without overflow. No wallet transactions or real SOL spending. JUP/MET launch configurations remain pending; quote-price coverage does not enable their launches.

## 2026-09-17 — Install confirmed JUP/MET configurations

The owner's saved setup-JUP and setup-MET intents were already confirmed; production had neither DBC_CONFIG_JUP nor DBC_CONFIG_MET. Read-only database lookup identified the accounts, then finalized signature status and on-chain configuredPool checks verified quote mints, decimals, fee recipients, supply/fees, migration and permanent LP locks. Migration thresholds also matched the signed review: 46,093 JUP and 49,964 MET. Public verification record: `.data/mainnet/confirmed-token-configs.json`.

Installed production-only DBC_CONFIG_JUP=`Hbgk9YsFaXx1V3vfaU3tcXj1MTJ7iScMPBoJuLrcxUUR` and DBC_CONFIG_MET=`GJ9TXtjp7vWEK6vzBBdhEwF4vQGiTDynA8baHGEvXqS8`. No new chain transactions, signatures, or spending. Also bounded app configuration verification to two concurrent assets and coalesced simultaneous config requests after intermittent RPC failures were observed during live verification. Unit test, typecheck and production build passed.

Published final app `dpl_4Gbu49B19povDa3Q22mVR4XQXELr` (`https://oneonly-2oz71rkcv-kade.vercel.app`) at app.oneonly.lol. Live API reported JUP, MET and USDC creationEnabled=true and enabled=true, with no error reason. Desktop/mobile setup pages show both new configurations installed, and the creation form allows selecting JUP and MET. No purchase/launch transaction was sent by the verification checks.

## 2026-09-17 — PDF trading UX and reliability fixes

Applied the supplied seven-page review: uppercase ticker input, one-character names, an existing-token link for claimed tickers, Recent buys Explore sorting, dark-mode Max/notice contrast, Claim fee wording, USD price/reserve/chart/amount estimates, current-USD aggregated Office fees, and compact chart credits with the required notice on the public `/app/credits` page. Historical USD chart points use recorded trade USD volume divided by tokens exchanged; unpriced trades are omitted, not valued with today's price. Office revenue/payouts explicitly use current USD valuation and retain partial coverage indicators.

Trade buttons now request a fresh quote and open the wallet directly. Optional details sit beneath the estimate. Pending confirmation has a toast and confirmed trades retain their share popup. Launch/setup reviews remain. Wallet fee validation accepts equivalent static-account ordering and moved compute-budget instructions but preserves account privileges, payer, blockhash, lookup-table layout and ordered non-budget instructions. Full signatures are required and priority fees remain capped at 0.0001 SOL. Concurrent submit requests claim the prepared intent once before broadcasting. RPC reads share in-flight identical requests and retry transient HTTP errors once; broadcasts are not deduplicated by the transport. Hidden/overlapping client polling is suppressed.

Read-only incident findings:
- Reported signature `3ZtNus3syypMDfKJhCvmvpu6HZSRLBGWhxFWXwjcJQKwnanDCvYqSJbe7jKXnSH8AsGpVUbxNv9t758AroAKWX7f` successfully created ONE (`3a892461-8817-47e5-8150-523d733efa2d`) with no initial buy. Total payer debit was 0.02064384 SOL, including 0.0000114 SOL transaction fee; the rest funded account creation. The 1B minted supply went to the pool vault, not the creator. There was no missing purchase in this transaction.
- STABLE's prior CRCLX/NVDAX attempts expired. Its USDC launch `5597ce47-b581-4f66-8caa-375ee67fcc72` is active and correctly owns its ticker claim. Public live preview returned 315,906.386726 STABLE for a 1-USDC input at the time of inspection. This is a quote, not an execution test or a guarantee that Fomo supports its route.
- Share artwork does not currently calculate realized P&L. No cost-basis value was invented. Artificial buys/fabricated volume were not implemented.

Validation: 36 targeted unit/database tests passed, including signed fee mutation rejection, duplicate-submit protection, RPC coalescing, historical USD candles and optional first buys. Desktop/mobile direct-wallet, confirmation and fee-change scenarios passed. No transactions were signed or broadcast to mainnet during verification.

Published `dpl_4vPAVtSzJGC8ohy6kYfzm1QHebf7` (`https://oneonly-cg2qebt6x-kade.vercel.app`) at app.oneonly.lol. Production build and 26 targeted desktop/mobile browser cases passed across the validation runs. Post-deploy live checks at 1440px and 390px waited for USD chart points, confirmed readable copy-notice contrast and no overflow/runtime errors. Live API returned GIDDY USD price/reserve/cap, eight historical USD points, Recent buys ordering, and USD Office totals with 7/7 pool coverage. Published-wallet rejection and uppercase/existing-token link checks used fully mocked APIs; no mainnet funds were spent. Landing deployment was unchanged.
