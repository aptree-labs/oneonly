# Internal staging claim tests

A platform operator can provision a one-use `OO-TEST-` code to test the claim
flow without publishing an X post. This skips only post evidence: authenticated
wallet access, the existing X binding, challenge expiry, fee entitlements,
contract verification, and wallet signing still apply. Staging may use real
mainnet funds; entering the code itself does not send a transaction.

`CREATOR_FEE_TEST_GRANT` is a server-only JSON environment variable, scoped to
Vercel's `staging` branch. It contains `network`, `wallet`, `xId`,
`bindingVersion`, `tokenId`, `mint`, `expiresAt` (ISO timestamp), and `hash`
(SHA-256 of a cryptographically random `OO-TEST-` plus 32 hex digits). Only the
hash is deployed. Never return this configuration or the code from public APIs.
Use a short expiry and deliver the code privately to the approved tester.

The tester starts a fresh claim, pastes the code into **Post link**, and clicks
**Verify post**. The server requires every scope field to match and rejects the
code outside `ONEONLY_ENVIRONMENT=staging`, even if the variable is present.
The existing unique evidence constraint records `internal-test:<hash>`, so
concurrent requests or a second challenge cannot reuse the grant. Test evidence
is distinguishable from a real tweet in the internal ledger. Verification does
not mark the claim as paid.

The grant stops working at expiry without requiring a deployment. Remove the
environment variable when testing is complete; never copy it to production.
An expired or consumed code requires a newly provisioned grant.
