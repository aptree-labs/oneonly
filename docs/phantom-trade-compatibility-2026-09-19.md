# Phantom desktop trade compatibility — 19 September 2026

The reported purchase failed with “The wallet changed more than the network fee” and left the trade form pending. Investigation, tests and release checks used command-line tools, public documentation and read-only RPC requests; no browser was opened and no mainnet transaction was sent.

## Findings

- The client treated an explicit validation rejection from `/submit` as an uncertain broadcast. That kept a rejected approval pending.
- The server compared transaction version, account sets and all non-budget instructions exactly. It rejected both equivalent legacy/v0 encoding and added Lighthouse assertions.
- [Phantom documents wallet-added Lighthouse assertions](https://docs.phantom.com/developer-powertools/lighthouse). [Lighthouse source](https://github.com/Jac0xb/lighthouse/tree/4c579479c98635e419b1b167f08be02a71604a71/programs/lighthouse/src) distinguishes read-only assertions from memory writes and closes.
- The failed signed payload was not retained, so these compatibility cases are reproduced explanations, not a confirmed identification of the user's exact transaction change. Twelve recent public GIDDY receipts were checked; none contained Lighthouse instructions. The mainnet Lighthouse program account exists and is executable.

## Changes

- Explicit pre-broadcast validation/auth/rate-limit rejections unlock the trade form and clear its saved pending reference. Network errors and server failures retain confirmation recovery to avoid duplicate spending.
- Wallet-returned messages are decoded without reconstruction and persisted/broadcast byte-for-byte, including their signatures and safety assertions.
- Equivalent legacy/v0 encoding is accepted only when payer, original accounts and privileges, instruction order/data, blockhash and lookup tables still match.
- Only appended, single-account Lighthouse data/info/token assertions (opcodes 2, 3, 5, 6, 9, 10) are exempted from the original instruction comparison. Extra accounts must be readonly, unsigned and used by these assertions. Existing account privileges cannot change. Memory writes/closes, unknown operations, arbitrary programs, extra transfers and inserted pre-trade guards remain rejected.
- Priority fees remain capped at 100,000 lamports; signatures and the 1,232-byte packet limit remain enforced.
- Further validation failures identify which comparison failed and log only the intent ID and reason, not the signed payload or credentials.

## Verification

- `pnpm test`: 144 tests across 45 files passed.
- `pnpm typecheck`: all workspace packages passed.
- Coverage includes legacy/v0 transactions, lookup tables, exact-byte server submission, guard preservation, invalid signatures, changed amount/recipient/blockhash, privilege escalation, forbidden Lighthouse operations and ambiguous network recovery.
- Browser fixture coverage was updated but not run, respecting the user's no-browser request.
- An actual successful retry in Phantom remains necessary to confirm the reported incident is resolved; no user wallet transaction was performed during this work.

## Release

- Production build passed and deployment `dpl_59FQHLfwffKe5SB4RNJuNTKoFc81` became READY at `https://oneonly-gt26f9isa-kade.vercel.app`, aliased to `https://app.oneonly.lol`.
- Post-deployment check at 08:03 UTC: off-chain sign-in with a newly generated unfunded identity succeeded (challenge/verify/session/logout); replay was rejected with 401. The nonce remained compliant, 32 alphanumeric characters.
- Live GIDDY SOL buy and sell previews both returned 200 in 1.164s and 0.923s respectively. These are quote/API checks, not executed swaps.
