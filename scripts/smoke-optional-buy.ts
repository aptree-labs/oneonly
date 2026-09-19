/** No network or spending: copied mainnet programs execute entirely inside LiteSVM. */
import { memoryChain } from "./memory-chain";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { FailedTransactionMetadata } from "../packages/protocol/node_modules/litesvm";
import {
  Keypair,
  PublicKey,
  ComputeBudgetProgram,
} from "../packages/protocol/node_modules/@solana/web3.js";
import {
  DynamicBondingCurveClient,
  SwapMode,
  getCurrentPoint,
  deriveDbcPoolAddress,
} from "../packages/protocol/node_modules/@meteora-ag/dynamic-bonding-curve-sdk";
import {
  TOKEN_2022_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
} from "../packages/protocol/node_modules/@solana/spl-token";
import BN from "../packages/protocol/node_modules/bn.js";
const requireProtocol = createRequire(
  resolve("packages/protocol/package.json"),
);
const kit = createRequire(requireProtocol.resolve("litesvm"))("@solana/kit");

async function main() {
  const { rpc, wallet, send, svm } = await memoryChain();
  process.env.SOLANA_NETWORK = "mainnet-beta";
  process.env.SOLANA_RPC_URL = "http://127.0.0.1:1";
  process.env.ONEONLY_FEE_WALLET = wallet.publicKey.toBase58();
  const protocol = await import("../packages/protocol/src/index");
  const sdk = new DynamicBondingCurveClient(rpc, "confirmed");
  const config = Keypair.generate();
  process.env.DBC_CONFIG_TOKEN2022_SOL = config.publicKey.toBase58();
  const configTx = await sdk.partner.createConfig({
    ...protocol.defaultCurve("SOL"),
    config: config.publicKey,
    payer: wallet.publicKey,
    feeClaimer: wallet.publicKey,
    leftoverReceiver: wallet.publicKey,
    quoteMint: new PublicKey(protocol.QUOTE_MINTS.SOL),
  });
  await send(configTx, [config]);
  for (const firstBuy of [0n, 50_000_000n]) {
    const mint = Keypair.generate();
    const params = {
      baseMint: mint.publicKey,
      config: config.publicKey,
      name: "Optional buy test",
      symbol: "OPTIONAL",
      uri: "https://app.oneonly.lol/test-metadata.json",
      payer: wallet.publicKey,
      poolCreator: wallet.publicKey,
    };
    const poolAddress = deriveDbcPoolAddress(
      new PublicKey(protocol.QUOTE_MINTS.SOL),
      mint.publicKey,
      config.publicKey,
    );
    const state = await sdk.state.getPoolConfig(config.publicKey);
    const transaction =
      firstBuy === 0n
        ? await sdk.creator.createPool(params)
        : await sdk.creator.createPoolWithFirstBuy({
            createPoolParam: params,
            firstBuyParam: {
              buyer: wallet.publicKey,
              receiver: wallet.publicKey,
              buyAmount: new BN(firstBuy.toString()),
              minimumAmountOut: sdk.pool.getQuoteFromInputAmount({
                config: state!,
                swapBaseForQuote: false,
                amountIn: new BN(firstBuy.toString()),
                slippageBps: 100,
                hasReferral: false,
                eligibleForFirstSwapWithMinFee: false,
                swapMode: SwapMode.ExactIn,
              }).minimumAmountOut!,
              referralTokenAccount: null,
            },
          });
    const built = { transaction, pool: poolAddress.toBase58() };
    built.transaction.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    );
    await send(built.transaction, [mint]);
    const pool = await sdk.state.getPool(built.pool);
    if (!pool || !pool.poolState.creator.equals(wallet.publicKey))
      throw new Error("Pool not created");
    const creatorAta = getAssociatedTokenAddressSync(
      mint.publicKey,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const creatorBalance = await getAccount(
      rpc,
      creatorAta,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    )
      .then((a) => a.amount)
      .catch(() => 0n);
    if (
      firstBuy === 0n &&
      (creatorBalance !== 0n || !pool.poolState.quoteReserve.isZero())
    )
      throw new Error("Unexpected creator purchase");
    if (firstBuy > 0n && creatorBalance <= 0n)
      throw new Error("Optional creator purchase missing");
    const buyer = Keypair.generate();
    svm.airdrop(buyer.publicKey.toBase58() as any, 1_000_000_000n as any);
    const quote = sdk.pool.swapQuote2({
      virtualPool: pool,
      config: state!,
      swapBaseForQuote: false,
      amountIn: new BN(10_000_000),
      slippageBps: 100,
      hasReferral: false,
      eligibleForFirstSwapWithMinFee: false,
      swapMode: SwapMode.ExactIn,
      currentPoint: await getCurrentPoint(rpc, state!.activationType),
    });
    const tx = await sdk.pool.swap2({
      pool: new PublicKey(built.pool),
      owner: buyer.publicKey,
      swapBaseForQuote: false,
      amountIn: new BN(10_000_000),
      minimumAmountOut: quote.minimumAmountOut!,
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: null,
    });
    tx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    );
    // The second wallet pays and signs alone; the creator is no longer involved.
    tx.feePayer = buyer.publicKey;
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(buyer);
    const purchase = svm.sendTransaction(
      kit.getTransactionDecoder().decode(tx.serialize()),
    );
    if (purchase instanceof FailedTransactionMetadata)
      throw new Error(String(purchase.err()));
    svm.expireBlockhash();
    const balance = await getAccount(
      rpc,
      getAssociatedTokenAddressSync(
        mint.publicKey,
        buyer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
      ),
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    if (balance.amount <= 0n)
      throw new Error("Independent buyer received no tokens");
    console.log({
      firstBuy: firstBuy.toString(),
      creatorBalance: creatorBalance.toString(),
      independentBuyerBalance: balance.amount.toString(),
      passed: true,
    });
  }
}
main().catch((e) => {
  console.error(e.message, e.logs ?? "");
  process.exitCode = 1;
});
