/** Read-only: simulates unsigned config creation; never submits a transaction. */
import {
  Connection,
  PublicKey,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "../packages/protocol/node_modules/@solana/web3.js";
import { getMint } from "../packages/protocol/node_modules/@solana/spl-token";
import { DynamicBondingCurveClient } from "../packages/protocol/node_modules/@meteora-ag/dynamic-bonding-curve-sdk";
import { defaultCurve, MAINNET_TOKENS } from "../packages/protocol/src/index";
import { GENESIS_HASHES } from "../packages/core/src/network";

async function main() {
  const rpc = new Connection(
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
  if ((await rpc.getGenesisHash()) !== GENESIS_HASHES["mainnet-beta"])
    throw new Error("Mainnet required");
  const owner = new PublicKey("9rHYpiomWrMNhMb76BabYWzCVMYudBXqhHuQqJBRMrcR");
  const sdk = new DynamicBondingCurveClient(rpc, "confirmed");
  for (const token of MAINNET_TOKENS) {
    const mint = await getMint(rpc, new PublicKey(token.mint));
    if (
      mint.decimals !== 6 ||
      mint.mintAuthority ||
      mint.freezeAuthority ||
      mint.tlvData.length
    )
      throw new Error(`${token.symbol}: unexpected mint`);
    const config = Keypair.generate();
    const tx = await sdk.partner.createConfig({
      ...defaultCurve(token.symbol, 50_000, "mainnet-beta"),
      payer: owner,
      config: config.publicKey,
      feeClaimer: owner,
      leftoverReceiver: owner,
      quoteMint: new PublicKey(token.mint),
    });
    const { blockhash } = await rpc.getLatestBlockhash();
    const wire = new VersionedTransaction(
      new TransactionMessage({
        payerKey: owner,
        recentBlockhash: blockhash,
        instructions: tx.instructions,
      }).compileToV0Message(),
    );
    const result = await rpc.simulateTransaction(wire, { sigVerify: false });
    console.log(
      JSON.stringify({
        symbol: token.symbol,
        mint: token.mint,
        decimals: mint.decimals,
        error: result.value.err,
        units: result.value.unitsConsumed,
        logs: result.value.logs,
      }),
    );
    if (result.value.err) throw new Error(`${token.symbol}: simulation failed`);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
