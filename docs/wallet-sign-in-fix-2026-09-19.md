# Wallet sign-in formatting fix

The purchase flow authenticates before preparing a trade. The sign-in message used a hyphenated database UUID as its SIWS nonce. Phantom's SIWS specification requires at least eight alphanumeric characters, so this was a malformed sign-in request. Existing wallet UI fixtures began with an authenticated session and did not exercise this path.

Changed only nonce generation in `apps/web/src/lib/launchpad/auth.ts`: use 16 random bytes encoded as 32 hex characters, independently of the database UUID. Domain, wallet binding, chain, expiration, exact-byte Ed25519 verification and atomic single-use consumption remain enforced.

Regression reproduced before the fix: the formatting assertion rejected a hyphenated UUID. After the fix, all 126 tests in 44 files and type checks passed. New local PostgreSQL tests cover message format/uniqueness, valid signatures and secure session creation, replay rejection, wrong-wallet signatures and expiry.

Deployed to https://app.oneonly.lol on 19 September 2026: `dpl_Hb78NgqhXRGcGBUoHjT6emu1Cf5S` / https://oneonly-6yupvixlz-kade.vercel.app. Production build passed.

Live verification at 07:34 UTC with a generated, unfunded test wallet: challenge HTTP 200 with valid 32-character nonce; signed login verification HTTP 200; matching authenticated session; replay HTTP 401; logout HTTP 200. No blockchain transactions or spending. This verifies the server's sign-in round trip, not a live Phantom extension purchase.

Reference: https://github.com/phantom/sign-in-with-solana#sign-in-input-fields
