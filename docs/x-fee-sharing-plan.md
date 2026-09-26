# X-linked creator fees: architecture and delivery plan

Status: research and proposed design, 26 September 2026. No fee-sharing contract or production claim gate has been implemented by this document.

## Decision

Keep Meteora for trading, bonding curves, and graduation. Use a small OneOnly fee-escrow program for X-linked allocations and withdrawals. A server verifies X ownership and the required claim post; the program enforces the configured shares and consumes each withdrawal authorization once.

A custom program is not strictly necessary if OneOnly holds a custodial signing key and manages every allocation and payment off-chain. That alternative requires users to trust OneOnly with the funds. Transferring fees directly to recipient wallets or applying a UI-only post gate would let recipients bypass the post requirement. For on-chain splits and an enforceable post requirement, the escrow approach is the recommended design.

The X verifier remains trusted even with a contract: Solana cannot independently read X. Program upgrade authority and verifier-key governance must also be disclosed; this is not a claim of fully trustless identity verification.

## Confirmed scope

- A launcher may allocate the creator-fee portion among multiple X accounts and optionally retain a share.
- Recipients need not have used OneOnly before allocation. The allocation remains theirs until they claim; it does not return to the launcher because they have not joined.
- Resolve accounts to stable numeric X IDs. Handles, names, and avatars are display data and may change.
- Link the recipient's X account to a wallet after proving control of both.
- **A fresh X post verified through twitterapi.io is required before each final claim.** Linking once does not replace this requirement; this reflects the latest user instruction.
- Show recipient profiles, linked tokens, and unclaimed fees in a leaderboard tab and unified search.
- Stage and demonstrate on Solana devnet with test funds before production.

Working defaults requiring product confirmation before production: shares become immutable when the token launches; shares sum to 10,000 basis points; the same X ID cannot occur twice in one allocation; a retained launcher share follows the same X-post rule and therefore requires a linked X account. No promotional endorsement language is required in the verification post. Recipient count and wallet recovery policy remain decisions, not shipped behavior.

## What already exists

| Evidence | Implication |
| --- | --- |
| OneOnly `apps/web/src/lib/launchpad/transactions.ts` checks `token.creator === wallet` before claims. | Current authorization must change for escrow-enabled pools; changing profile display alone cannot assign fees. |
| `packages/protocol/src/index.ts` builds DBC creator claims and DAMM v2 position-owner claims. | Pre- and post-graduation authority must both be integrated. |
| `apps/web/src/lib/x-link.ts`, `launchpad/profile.ts`, and the X callback already link verified profile IDs to wallet sessions. | Reuse the authenticated identity flow, but separate social-profile linking from financial beneficiary binding. Existing mutable profile records must not silently reassign claim rights. |
| Meteora DBC SDK exposes creator-authority transfer and fee claims to a receiver. | Existing Meteora contracts provide the collection plumbing. [DBC SDK documentation](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk/blob/main/packages/dynamic-bonding-curve/docs.md). |
| Meteora Dynamic Fee Sharing supports wallet shares and collection from DBC and DAMM v2; its documentation specifies two to five recipients. | Useful infrastructure, but no documented X-identity or fresh-post claim rule. It does not remove the need for our verification and escrow logic. [DFS documentation](https://github.com/MeteoraAg/dynamic-fee-sharing-sdk/blob/main/docs.md). |

The installed protocol dependencies are DBC SDK 1.5.12 and CP-AMM SDK 1.4.8. Public upstream source may differ from deployed programs; pin versions and validate actual devnet/mainnet program behavior before relying on compatibility.

## Authority and graduation

Use a per-pool escrow PDA as the DBC creator authority. Configure it during creation or transfer authority atomically with creation, so the launcher never has a window to collect assigned fees. If transaction constraints prevent an atomic sequence, the flow must not present fee assignment as complete until the authority transition is confirmed; resolve this in the integration proof before enabling launches.

The reviewed DBC transfer instruction changes the pool's creator field and permits only particular migration states. It does not transfer an already-created DAMM position. [Creator-transfer source](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/main/programs/dynamic-bonding-curve/src/instructions/creator/ix_transfer_pool_creator.rs).

The reviewed DAMM v2 migration source assigns creator position ownership using the DBC creator at migration time. This supports the proposed PDA route for new pools. Existing graduated pools need a separate, authorized position-ownership transfer; changing their DBC creator is insufficient. Verify both paths with the exact deployed program and pool configuration. [Migration source](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/main/programs/dynamic-bonding-curve/src/instructions/migration/dynamic_amm_v2/migrate_damm_v2_initialize_pool.rs).

Escrow must support claims from the creator position without granting a withdrawal path for liquidity principal or changing its locks. Keep partner/platform revenue separate. Explicitly decide how migration fees, surplus, and vested tokens are handled; do not inadvertently include them in “creator trading fees.” Existing tokens are opt-in only and require the current authority's authorization.

## Proposed data and accounting

- On-chain pool allocation: pool and mint identities, recipient X-ID commitments, fixed shares, and allocation version. Derive commitments with a versioned domain prefix.
- Beneficiary binding: X-ID commitment, authorized wallet, binding version, and controlled recovery state. The launcher cannot bind a recipient's wallet.
- Per-mint fee ledger: actual amounts collected, total entitlement, and cumulative claims. Use integer token units, checked arithmetic, deterministic rounding, and preserve dust for future claims.
- Claim receipt: pool scope, beneficiary, binding version, destination, mint/amount limits, nonce, expiry, and consumed status. Redemption and consumption happen atomically.
- Database projection: profiles, token associations, indexed deposits/claims, challenge state, and verification evidence. Treat this as a display/search index; the contract remains the source of withdrawal limits.

Collection and allocation must be idempotent. Base-token and quote-token fees remain separate amounts. Do not add SOL, JUP, MET, and USDC units together: show asset breakdowns and a separately labelled USD estimate. Clearly distinguish accrued-at-Meteora fees from already-collected escrow balances and avoid counting both.

## Claim verification

1. Require an authenticated wallet session and a valid X-to-wallet binding. For a new binding, use the X login proof plus a wallet-signed, expiring challenge scoped to OneOnly and the correct network.
2. Issue a random, single-use claim challenge bound to that X ID, wallet, binding version, pool/batch scope, and expiry. Show exactly which fees and destination it authorizes.
3. Open an X compose intent containing a neutral claim statement and the unique code. The user publishes it; OneOnly does not post automatically.
4. Accept a tweet URL or search for the code. Resolve the result server-side through twitterapi.io, checking the stable author ID, exact challenge token, publication time after issuance, expiry, and a permitted original-post type. Reject reposts, copied codes from another author, and already-used evidence.
5. After verification, issue a short-lived signed attestation covering the complete claim scope, network/program domain, beneficiary, destination, amounts, binding version, nonce, and expiry. A bare tweet ID or `verified: true` flag is never sufficient.
6. The program verifies the configured verifier signature, claimant wallet signature, matching allocation/binding, available entitlement, and nonce. It atomically pays and consumes the authorization. Failed transactions can retry the same unconsumed authorization within expiry; an unknown transaction status must be reconciled before issuing a replacement.

twitterapi.io's user endpoint returns the numeric account ID and profile data, and its tweet search response includes author ID, text, tweet ID, and creation time. These are the required checks; provider access, freshness, and availability still need integration testing. [User lookup](https://docs.twitterapi.io/api-reference/endpoint/get_user_by_username), [tweet search](https://docs.twitterapi.io/api-reference/endpoint/tweet_advanced_search).

Store API keys only on the server. Fail closed when verification is unavailable and keep funds claimable later. Use bounded retries and a clear pending state for indexing delays. Linking is identity verification, not a multisig. If the verifier is compromised, false identity assertions remain a risk; key rotation, incident response, upgrade controls, and a carefully reviewed recovery policy are launch requirements.

## UI flow

**Launch:** optional “Share creator fees” section → search X accounts → show avatar/handle and assigned percentage → validate total → review immutable allocation → launch. Say “Fees allocated to” rather than implying that a recipient created or endorsed the token.

**Recipient:** connect X + wallet → see associated tokens and available asset balances → select claim → “Post on X” → “Verify post” with retry/loading feedback → review destination and amount → approve wallet → confirmed receipt. Keep the amount and completed steps visible; clear only after confirmation. Allow a batch claim when it fits safely, with the post explicitly scoped to the selected batch.

**Discovery:** Tokens / Fee recipients search groups, distinct profile result labels, token counts, and amount freshness. Recipient leaderboard opens the associated token list. Empty and unavailable states must not imply a zero balance.

## Roadmap and release gates

| Stage | Deliverable | Exit gate |
| --- | --- | --- |
| 1. Staging and integration proof | Isolated devnet deployment; validate PDA creation/authority, fee collection, graduation, and post-graduation claims. | Successful end-to-end devnet receipts with a PDA beneficiary and no launcher bypass. |
| 2. UI and verifier | Launch allocation editor, profile search, recipient dashboard, X post verification, realistic demo states. | Identity and challenge tests pass; mock data visibly labelled. |
| 3. Escrow program | Fixed allocations, per-mint accounting, binding, verifier attestations, claim receipts, events. | Property/security tests and full devnet lifecycle pass, including concurrent claims. |
| 4. Review and operations | Independent contract/security review, signer/upgrade governance, reconciliation, monitoring and recovery runbook. | Findings resolved; controls exercised; exact release build recorded. |
| 5. Production release | Reviewed deployment and deliberate enablement for new opt-in pools; existing pool migration separately scoped. | Explicit production readiness decision and verified mainnet configuration. |

Stages 1–2 can support a cofounder demo while contract work proceeds. Monday is a target for a demonstrable staging flow, not a guarantee that a new financial contract is production-safe by then.

## Acceptance tests

- Allocate to an X account that has never joined; multiple tokens accrue independently; launcher cannot claim another recipient's share through OneOnly or directly through Meteora.
- Verify exact share totals, duplicate rejection, integer rounding, tiny amounts, repeated collection, base/quote fee assets, and cumulative claims never exceeding deposits.
- Reject wrong author, renamed/recycled handle confusion, wrong wallet, altered destination/amount/scope, expired or missing post, old binding version, reused nonce, and cross-pool/network replay.
- Two concurrent redemption attempts yield at most one payout. Wallet rejection, dropped transactions, provider timeouts, and delayed tweet indexing preserve recoverable state.
- Graduate a Token-2022 pool and confirm escrow position authority, fee claims, and unchanged liquidity locks. Check old DBC fees and new DAMM fees without omission or duplication.
- A profile relink cannot change financial entitlement; recovery cannot be exercised by the launcher or a social-profile API update.
- Leaderboard/search projections reconcile to deposits and claims, show asset breakdowns, and retain pagination and bounded queries.
- Staging cannot consume production claim attestations or alter production pool authorities.
