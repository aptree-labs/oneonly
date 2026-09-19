import { memoryChain } from "./memory-chain";
import { readFile, writeFile } from "node:fs/promises";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "../packages/protocol/node_modules/@solana/web3.js";
import {
  DynamicBondingCurveClient,
  SwapMode,
  deriveDbcPoolAddress,
  getCurrentPoint,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  deriveDammV2PoolAddress,
} from "../packages/protocol/node_modules/@meteora-ag/dynamic-bonding-curve-sdk";
import {
  CpAmm,
  SwapMode as DammSwapMode,
  getTokenProgram,
} from "../packages/protocol/node_modules/@meteora-ag/cp-amm-sdk";
import BN from "../packages/protocol/node_modules/bn.js";
import { MAINNET_STOCKS } from "../packages/protocol/src/mainnet-stocks";
import { GENESIS_HASHES } from "../packages/core/src/network";

async function main() {
  const { rpc, wallet, send: sendInMemory } = await memoryChain();
  const sdk = new DynamicBondingCurveClient(rpc, "confirmed"),
    damm = new CpAmm(rpc);
  const configs: { symbol: string; address: string }[] = JSON.parse(
    await readFile(".data/mainnet/confirmed-stock-configs.json", "utf8"),
  );
  const evidence: unknown[] = [];
  async function send(tx: Transaction, signers: Keypair[] = []) {
    tx.instructions = tx.instructions.filter(
      (ix) =>
        !(
          ix.programId.equals(ComputeBudgetProgram.programId) &&
          ix.data[0] === 2
        ),
    );
    tx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    );
    return sendInMemory(tx, signers);
  }
  for (const stock of MAINNET_STOCKS) {
    const steps: string[] = [];
    try {
      const configAddress = new PublicKey(
          configs.find((item) => item.symbol === stock.symbol)!.address,
        ),
        config = await sdk.state.getPoolConfig(configAddress),
        mint = Keypair.generate();
      if (!config) throw new Error("Missing copied configuration");
      const pool = deriveDbcPoolAddress(
        new PublicKey(stock.mint),
        mint.publicKey,
        configAddress,
      );
      const firstAmount = config.migrationQuoteThreshold.divn(100);
      const firstQuote = sdk.pool.getQuoteFromInputAmount({
        config,
        swapBaseForQuote: false,
        amountIn: firstAmount,
        slippageBps: 100,
        hasReferral: false,
        eligibleForFirstSwapWithMinFee: false,
        swapMode: SwapMode.ExactIn,
      });
      await send(
        await sdk.creator.createPoolWithFirstBuy({
          createPoolParam: {
            baseMint: mint.publicKey,
            tokenBadge: new PublicKey(stock.badge),
            config: configAddress,
            name: "Local stock lifecycle",
            symbol: "LOCAL",
            uri: "https://app.oneonly.lol",
            payer: wallet.publicKey,
            poolCreator: wallet.publicKey,
          },
          firstBuyParam: {
            buyer: wallet.publicKey,
            receiver: wallet.publicKey,
            buyAmount: firstAmount,
            minimumAmountOut: firstQuote.minimumAmountOut!,
            referralTokenAccount: null,
          },
        }),
        [mint],
      );
      steps.push("launch-and-first-buy");
      for (const [sell, amount] of [
        [true, new BN(1_000_000)],
        [false, config.migrationQuoteThreshold.muln(2)],
      ] as const) {
        const virtualPool = await sdk.state.getPool(pool);
        if (!virtualPool) throw new Error("Missing launched pool");
        const quote = sdk.pool.swapQuote2({
          virtualPool,
          config,
          swapBaseForQuote: sell,
          amountIn: amount,
          slippageBps: 100,
          hasReferral: false,
          eligibleForFirstSwapWithMinFee: false,
          swapMode: sell ? SwapMode.ExactIn : SwapMode.PartialFill,
          currentPoint: await getCurrentPoint(rpc, config.activationType),
        });
        await send(
          await sdk.pool.swap2({
            pool,
            owner: wallet.publicKey,
            swapBaseForQuote: sell,
            amountIn: amount,
            minimumAmountOut: quote.minimumAmountOut!,
            swapMode: sell ? SwapMode.ExactIn : SwapMode.PartialFill,
            referralTokenAccount: null,
          }),
        );
        steps.push(sell ? "curve-sell" : "fill-curve");
      }
      await send(
        await sdk.creator.claimCreatorTradingFee({
          pool,
          creator: wallet.publicKey,
          payer: wallet.publicKey,
          maxBaseAmount: new BN("18446744073709551615"),
          maxQuoteAmount: new BN("18446744073709551615"),
        }),
      );
      steps.push("curve-fee-claim");
      const migration = await sdk.migration.migrateToDammV2({
        pool,
        payer: wallet.publicKey,
        dammConfig: DAMM_V2_MIGRATION_FEE_ADDRESS[6],
      });
      await send(migration.transaction, [
        migration.firstPositionNftKeypair,
        migration.secondPositionNftKeypair,
      ]);
      steps.push("graduate");
      const destination = deriveDammV2PoolAddress(
        DAMM_V2_MIGRATION_FEE_ADDRESS[6],
        mint.publicKey,
        config.quoteMint,
      );
      for (const sell of [false, true]) {
        const state = await damm.fetchPoolState(destination),
          amount = new BN(sell ? 1_000_000 : 100_000);
        const quote = damm.getQuote2({
          poolState: state,
          inputTokenMint: sell ? state.tokenAMint : state.tokenBMint,
          amountIn: amount,
          swapMode: DammSwapMode.ExactIn,
          slippage: 100,
          hasReferral: false,
          currentPoint: await getCurrentPoint(rpc, state.activationType),
          tokenADecimal: 6,
          tokenBDecimal: 8,
        });
        await send(
          await damm.swap2({
            pool: destination,
            poolState: state,
            payer: wallet.publicKey,
            inputTokenMint: sell ? state.tokenAMint : state.tokenBMint,
            outputTokenMint: sell ? state.tokenBMint : state.tokenAMint,
            tokenAMint: state.tokenAMint,
            tokenBMint: state.tokenBMint,
            tokenAVault: state.tokenAVault,
            tokenBVault: state.tokenBVault,
            tokenAProgram: getTokenProgram(state.tokenAFlag),
            tokenBProgram: getTokenProgram(state.tokenBFlag),
            amountIn: amount,
            minimumAmountOut: quote.minimumAmountOut!,
            swapMode: DammSwapMode.ExactIn,
            referralTokenAccount: null,
          }),
        );
        steps.push(sell ? "graduated-sell" : "graduated-buy");
      }
      const state = await damm.fetchPoolState(destination),
        positions = await damm.getUserPositionByPool(
          destination,
          wallet.publicKey,
        );
      if (!positions.length) throw new Error("Missing creator position");
      const position = positions[0];
      await send(
        await damm.claimPositionFee2({
          owner: wallet.publicKey,
          receiver: wallet.publicKey,
          pool: destination,
          position: position.position,
          positionNftAccount: position.positionNftAccount,
          tokenAMint: state.tokenAMint,
          tokenBMint: state.tokenBMint,
          tokenAVault: state.tokenAVault,
          tokenBVault: state.tokenBVault,
          tokenAProgram: getTokenProgram(state.tokenAFlag),
          tokenBProgram: getTokenProgram(state.tokenBFlag),
        }),
      );
      steps.push("graduated-fee-claim");
      evidence.push({ symbol: stock.symbol, passed: true, steps });
      console.log(stock.symbol, steps.join(", "));
    } catch (error) {
      const failure = error as Error & { logs?: string[] };
      evidence.push({
        symbol: stock.symbol,
        passed: false,
        steps,
        error: failure.message,
        logs: failure.logs,
      });
      console.error(stock.symbol, failure.message);
      if (failure.logs) console.error(failure.logs.slice(-12).join("\n"));
    }
    await writeFile(
      ".data/mainnet-fork/results.json",
      JSON.stringify(
        {
          source: "mainnet public accounts/programs",
          execution: "LiteSVM in-memory only",
          generatedAt: new Date().toISOString(),
          evidence,
        },
        null,
        2,
      ),
    );
  }
  if (evidence.some((item: any) => !item.passed)) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
