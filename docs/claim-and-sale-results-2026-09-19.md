# Creator claims and sale results — 2026-09-19

## Changes

- Creator-fee claims now use the same bounded wallet-transaction compatibility path as trades. The exact approved signed wire is persisted and submitted; no reserialization after signing and no repeated approval solely for a permitted wallet adjustment.
- Accept valid Solana RequestHeapFrame (opcode 1, 32–256 KiB, 1 KiB alignment) and SetLoadedAccountsDataSizeLimit (opcode 4, positive, at most 64 MiB) compute-budget instructions. Existing priority-fee and CU caps remain. Original instruction data, recipient/accounts and permissions remain checked. Duplicate, malformed, unknown and out-of-range additions remain rejected.
- Confirmed buys/sells clear the amount and derived quote. Rejected or failed approvals preserve the amount for retry.
- Sell success popup and downloadable/X card include tokens sold, actual pool proceeds, average acquisition cost of the sold units, and estimated pool P&L/percentage. A verified confirmed intent binds the card to its token, wallet and transaction; amounts cannot be supplied through URL parameters.
- Sale proceeds come from finalized swap events, not the index's fee-inclusive volume field. Cost uses integer accounting and only that wallet's indexed purchases. Missing history, transferred balances or ambiguous order produce unavailable P&L. Finalization/indexing delays show pending with refresh.
- Pool P&L excludes network and routing fees, and is labelled estimated. It is not a full wallet or tax accounting ledger. No schema changes.

## Evidence and limits

- 158 automated tests across 47 files pass; all workspace type checks pass.
- Local database tests verify receipt binding, incorrect-token/side/status rejection, fee-net proceeds, partial-sale cost, incomplete coverage and transferred balances.
- Transaction tests verify bounded claim adjustments and rejection of changed claim data before broadcasting.
- Full-size and wide X sale cards rendered and inspected as PNG files without opening a browser.
- Browser regression fixtures updated for successful input clearing and preserved failed inputs, but not executed, honoring the user's no-browser request.
- No mainnet transaction was signed or broadcast by this work.
- The exact failed Phantom payload is not available. The screenshot establishes an instruction comparison failure, but does not prove which additional instruction caused it. A fresh user-approved claim is still required to confirm behavior with the user's extension.

References: [Solana compute budgets](https://solana.com/docs/core/fees/compute-budget), [Phantom Lighthouse](https://docs.phantom.com/developer-powertools/lighthouse).

## Production verification

- Deployment `dpl_GYQ52KMndRNnYTjngfz4NbkYFgNn` is READY at https://oneonly-8kt5v05oi-kade.vercel.app, aliased to https://app.oneonly.lol.
- Cloud production build passed.
- Read-only live checks against two existing finalized sales (GIDDY and BACKPACK) returned ready P&L and HTTP 200 PNG cards. A mismatched token/sale request returned 404.
- GIDDY fixture: 1,840,770.73799 tokens sold; pool proceeds 0.048367749 SOL; allocated average cost 0.0496 SOL; estimated pool P&L −0.001232251 SOL (−2.48%). Live generated card visually inspected.
