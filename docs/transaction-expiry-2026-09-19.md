# Transaction expiry follow-up — 19 September 2026

Deployed as `dpl_oWXFA6hCeewGDeE4ToEAJ81ZL7V5` (`https://oneonly-qqaxpzpcr-kade.vercel.app`) to `https://app.oneonly.lol`, preserving the preceding Token-2022 rollout release and excluding unrelated concurrent work.

The owner's expired SOL Token-2022 setup intent `b3ef6062-67cc-47d6-9a0c-a3821971b46b` had a recorded signature but no signature status in RPC history and no created config account. Re-simulating its stored transaction with a replaced recent blockhash and signature verification disabled succeeded (36,896 compute units). This was simulation only; nothing was broadcast by the agent.

The exact original broadcast failure is unknown because its RPC error was not retained. The connection already defaulted to confirmed commitment; a commitment mismatch was not established.

Changes:

- Submitted transactions now use explicit confirmed preflight and the RPC's default retry policy instead of stopping after three retries.
- Confirmation polling resends the exact stored signed bytes only while the blockhash remains valid and RPC has no status. It never creates another transaction or changes its signature. Duplicate submit requests don't trigger an immediate extra resend.
- Token-2022 setup is checked again after authentication and immediately before wallet approval. An unsigned setup with fewer than 100 blocks remaining is retired with a conditional database update and rebuilt with a new config co-signer. Submitted/confirmed setup is never replaced while its outcome remains uncertain.
- Expired setup reviews offer Refresh and approve. Confirmed setups continue to resume the original result rather than charge rent again.

Validation: 21 focused setup/submission tests and workspace type checks passed. Tests cover unchanged signed bytes, overlapping submissions, avoiding rebroadcast of processed transactions, refreshing stale unsigned setup, and preserving submitted setup.

User guidance: refresh the app after deployment, unlock Phantom before starting, prepare one configuration at a time, and approve promptly. Solana's recent blockhash validity is approximately 60–90 seconds; it cannot be extended after signing. See https://solana.com/developers/cookbook/transactions/confirmation.
