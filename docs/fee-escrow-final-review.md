# Escrow engineering review — 2026-09-27

This is an internal engineering review, not an independent security audit, a guarantee of safety, or approval to fund/deploy mainnet. Reviewed the working tree based on `0879898`, followed by the unsupported-venue fix and bounded deployment-batching implementation.

## Result

No critical/high theft, unauthorized payout, or replay defect was identified in the reviewed claim/allocation/collection/control and web authorization paths. The unsupported-venue opt-in defect identified below has been corrected and re-reviewed. Passing source review does not replace the live acceptance gates below.

## Resolved finding: reject unsupported graduation venues before moving creator authority

`packages/fee-escrow/program/src/lib.rs:67` verifies the DBC pool/config identity and pre-graduation state, but the reviewed version did not restrict the configuration's migration option. A direct caller could permanently transfer its creator authority into escrow for a DAMMv1 pool; this program only provides DBC and DAMMv2 collection. The application configuration validator already requires DAMMv2, so this does not bypass that normal launch flow or let an attacker steal another creator's fees. It is nevertheless an irreversible unsupported opt-in that the contract should reject.

The installed Meteora DBC SDK 1.5.12 account coder confirms `poolConfig.migrationOption` at account byte **233**, including the discriminator, with DAMMv2 value **1**. Re-encoding the fixture with values zero and one changes only that byte. Require `config_data.get(233) == Some(&1)` before the creator-transfer CPI. Regression coverage should reject zero and unknown values, verify no allocation account persists and the creator remains unchanged, and retain the real DAMMv2 transfer/collection success coverage.

Resolution re-reviewed: the contract now enforces that byte equals one before authority transfer. Added SDK-layout assertion and compiled Meteora runtime cases reject options zero, two and 255, leave the original creator unchanged and persist no allocation account. The implementation owner reports rebuilding the artifact and passing 27 runtime, 11 Meteora and 11 native tests. The reviewer inspected the guard and rejection assertions; no remaining finding on this path.

## Controls inspected

- Allocation ownership, pinned DBC program, pool/config discriminators, creator/base/quote identity, PDA seeds, exact nonduplicate positive shares totaling 10,000, and atomic creator transfer.
- Collection's pinned instruction layouts and programs, canonical allocation token accounts, mint/program matching, DAMMv2 NFT ownership, measured incoming balance deltas, and separate cumulative mint ledgers. No arbitrary CPI or liquidity withdrawal was found.
- Claims require the claimant signature, canonical recipient ATA, preceding Ed25519 verification, exact domain/program/allocation/mint/identity/wallet/destination/limit/nonce/time/epoch binding, positive remaining cumulative entitlement, and a unique receipt. A second claim cannot repeat an already paid cumulative amount. First payout permanently binds the X identity to its wallet on chain.
- Current loader upgrade authority controls configuration, pause and verifier rotation. Rotation increments an epoch, invalidating old proofs even after rotating back to the original verifier. Pause blocks claims/new allocations while collection remains possible.
- Web POST routes require origin and authenticated wallet session checks. X linking checks callback nonce and wallet session; longer-lived ownership proof is bound to session, identity, profile revision, origin and network. Claim challenges bind all economic scope, require a fresh original post by the exact stable X account ID, expire, and have unique post IDs. The server signs only a verified claim for the authenticated bound wallet; the contract independently caps the payout.
- Database uniqueness constrains each network/X identity and wallet binding. Cached display projections do not authorize withdrawals. Confirmed receipt reconciliation checks allocation, mint, claimant, nonce and amount.

## Deployment-console review

The original local-console cross-process journal race was fixed with an exclusive state-directory lock. Existing/stale locks require explicit reconciliation; orderly shutdown releases only its own lock. Exact message hashes and all required signatures are checked before broadcast. Loopback Host/Origin and a random capability protect endpoints. Genesis is checked before pending-state mutation. Every signed attempt remains reserved against the cumulative budget, including recovery attempts. Unknown outcomes retain exact bytes for rebroadcast; expired/unaccounted attempts block further approvals. Mainnet signing is disabled. Fixed-identity signing is blocked until build-receipt support exists; the enabled CLI signing path requires an isolated devnet receipt. The browser Cancel/signature race was also corrected.

The deployment owner reports package typecheck, 17 focused tests, and mocked desktop/mobile wallet-browser tests passing after those changes. This reviewer inspected the fixes; those results are not a real Jupiter extension or real chain deployment rehearsal. The local build receipt links source snapshots and artifact digest but does not establish a hermetic, independently reproduced build or independent audit.

### Bounded write-batch follow-up

Reviewed the subsequent planner/server/browser batching changes. No blocking defect identified. Only independent missing upload writes can batch, with a maximum of 16 and a shared fresh blockhash/expiry. Creation, final deployment and recovery remain single transactions. Every returned transaction must match its prepared message and contain valid signatures; a partial, reordered or modified result is rejected before saving or sending any transaction. The complete signed batch is fsynced before its first send. A partial send preserves all entries, including those not yet broadcast; all unresolved entries block later preparations. Restart and rebroadcast reuse exact signed bytes. Final deployment still requires the finalized buffer contents to match the artifact.

The aggregate reservation and remaining deployment allowance are checked at prepare and submit, and every failed attempt remains accounted for. Wallet batch support is gated by advertised Wallet Standard features; the UI displays transaction count, message hashes and aggregate costs, permits explicit single-step selection, and has no automatic retry approval. The request-size bound accommodates 16 full packets. These conclusions concern the reviewed implementation and regression coverage, not real Jupiter batch-signing behavior.

Final batching validation reported by the implementation owner: package typecheck passed; 23 focused tests passed (8 planner, 14 console, 1 receipt); 6 desktop/mobile mocked-wallet browser tests passed. The isolated artifact/receipt was rebuilt after the DAMMv2 guard. No real wallet signing or network mutation was performed for these checks.

## Architectural trust and accepted limitations

- X ownership/post verification is an off-chain oracle. A compromised verifier can authorize a false initial beneficiary binding; it cannot exceed that recipient's fixed share. Already bound wallets remain fixed. The upgrade authority can change program code and must be treated as trusted custody/governance authority.
- Immutable bindings do not include wallet recovery/rotation. Loss of a bound wallet can prevent future claims. This must be explicit before binding.
- An empty vault does not prove retirement safety: unbound X entitlements, rounding balances and future DBC/DAMMv2 fee rights can remain. No active-program closure, administrative sweep, or completed migration is approved by this review. See `fee-escrow-retirement.md`.
- Program/domain and web gates currently target devnet. Mainnet needs a separately reviewed release and environment binding, rather than simply switching an environment variable.

## Remaining acceptance gates

1. Preserve the now-passing unsupported-venue fix and compiled-runtime regression checks when producing the final release artifact.
2. Complete a real Jupiter devnet deployment with exact deployed artifact/authority verification, interrupted upload/restart behavior, and buffer refund into the nominated wallet; mocked wallet tests are insufficient.
3. Exercise real X OAuth, wallet binding, new-post verification, collection and recipient claim, then replay/second-wallet rejection and pause/rotation behavior on the deployed devnet program. Verify actual token balance changes and receipts.
4. Verify the supported graduation lifecycle and continued DAMMv2 collection/claims on chain. Existing LiteSVM tests execute compiled programs with fixture accounts; they are not a full live launch-to-graduation run.
5. Bind any mainnet release to the reviewed final source/artifact and network domain, confirm funding budget/current authority, and obtain the user's explicit wallet signatures. Do not claim arbitrary recovery of the storage deposit while beneficiary or future-fee obligations remain.

No mainnet deployment, wallet transfer, live closure, or secret disclosure was performed for this review.
