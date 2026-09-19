# Creator-claim repeated approval failure — 2026-09-19

## Finding

Production logs show `review-wallet-fee` returned 200 immediately before the reported `submit` returned 409 on deployment `dpl_GYQ52KMndRNnYTjngfz4NbkYFgNn`. The failed claim intent `8c345805-d7cb-487b-939a-74e4ad8e0a2f` had already stored two Phantom Lighthouse postconditions (opcodes 6 and 10) in its unsigned transaction.

The old fee-review endpoint saved the wallet's assertions as the new app baseline. When Phantom recalculated an assertion in another approval, the strict validator compared it as a fixed application instruction. The earlier compute-budget update did not address this persisted-guard loop. A client retaining the old review flow could still trigger it on the newer server.

## Fix

- Old `review-wallet-fee` calls for trades and claims now use the same strict submit path for the already wallet-approved signed bytes. They no longer freeze wallet postconditions into another unsigned approval.
- For an existing prepared creator claim containing wallet guards, rebuild its baseline from trusted token/pool data, verify the creator, preserve its original blockhash, and validate the signed result against that clean claim. Both curve and graduated fee venues are retained.
- The exact wallet-signed bytes are submitted. Core claim instructions, recipient, accounts, privileges, blockhash, signatures and bounded fees remain validated. Unknown or unsafe added instructions remain rejected.
- No schema changes, no broad relaxation of the generic validator, no browser use, and no mainnet broadcast during testing.

## Verification

- Read-only RPC rebuild of the actual failed GIDDY claim matched every original non-Lighthouse instruction.
- With a generated offline test payer and an updated wallet assertion, the frozen baseline reproduced the old rejection; the clean baseline accepted the exact signed bytes.
- Regression tests cover the cached-client review endpoint, recovery of a frozen claim, and rejection of tampered claim data without broadcasting.
- Full workspace suite: 188 tests / 50 files passed; all type checks passed. This includes unrelated admin tests currently present in the workspace.
- Release staged from the currently deployed app with only the four claim-fix source/test files overlaid, excluding unrelated unfinished admin work.

A live Phantom approval is still required to confirm the end-to-end claim. The prior reported intent expired; start a fresh claim instead of approving that old modal.

Unsigned mainnet simulation of the rebuilt GIDDY creator-fee claim succeeded (`err: null`, 38,245 compute units). Signature verification was disabled and the recent blockhash was replaced only for simulation. No transaction was broadcast.

Production deployment `dpl_2vkPiJqYB354w2CibTWNfGVY4G7D` is READY at https://oneonly-f7bz6f16q-kade.vercel.app and aliased to https://app.oneonly.lol. Cloud build and type checks passed.
