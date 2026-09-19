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
import { MAINNET_TOKENS } from "../packages/protocol/src/mainnet-tokens";
import { defaultCurve } from "../packages/protocol/src/index";
import {
  getMint,
  getTokenMetadata,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  MintLayout,
  AccountLayout,
  getAssociatedTokenAddressSync,
} from "../packages/protocol/node_modules/@solana/spl-token";
import { GENESIS_HASHES } from "../packages/core/src/network";

async function main() {
  const { rpc, wallet, svm, send: sendInMemory } = await memoryChain();
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
  const classic = [
    {
      symbol: "SOL",
      mint: "So11111111111111111111111111111111111111112",
      decimals: 9,
      setupThreshold: 85,
      badge: undefined,
    },
    {
      symbol: "USDC",
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      decimals: 6,
      setupThreshold: 10000,
      badge: undefined,
    },
    ...MAINNET_TOKENS.map((asset) => ({
      ...asset,
      setupThreshold: 10000,
      badge: undefined,
    })),
  ];
  // Synthetic classic-token balances in the local VM; no real quote assets used.
  for (const asset of classic.filter((asset) => asset.symbol !== "SOL")) {
    const mint = new PublicKey(asset.mint),
      data = Buffer.alloc(MintLayout.span);
    MintLayout.encode(
      {
        mintAuthorityOption: 0,
        mintAuthority: PublicKey.default,
        supply: 1000000000000000n,
        decimals: 6,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      data,
    );
    svm.setAccount({
      address: asset.mint as any,
      programAddress: TOKEN_PROGRAM_ID.toBase58() as any,
      lamports: 10000000n as any,
      data,
      executable: false,
      space: BigInt(data.length) as any,
    });
    const ata = getAssociatedTokenAddressSync(mint, wallet.publicKey),
      balance = Buffer.alloc(AccountLayout.span);
    AccountLayout.encode(
      {
        mint,
        owner: wallet.publicKey,
        amount: 100000000000000n,
        delegateOption: 0,
        delegate: PublicKey.default,
        state: 1,
        isNativeOption: 0,
        isNative: 0n,
        delegatedAmount: 0n,
        closeAuthorityOption: 0,
        closeAuthority: PublicKey.default,
      },
      balance,
    );
    svm.setAccount({
      address: ata.toBase58() as any,
      programAddress: TOKEN_PROGRAM_ID.toBase58() as any,
      lamports: 10000000n as any,
      data: balance,
      executable: false,
      space: BigInt(balance.length) as any,
    });
  }
  for (const stock of [...classic, ...MAINNET_STOCKS]) {
    const steps: string[] = [];
    try {
      const configKey = Keypair.generate(),
        configAddress = configKey.publicKey;
      const reference = configs.find((item) => item.symbol === stock.symbol);
      const current = reference
        ? await sdk.state.getPoolConfig(new PublicKey(reference.address))
        : {
            migrationQuoteThreshold: new BN(stock.setupThreshold).mul(
              new BN(10).pow(new BN(stock.decimals)),
            ),
          };
      if (!current) throw new Error("Missing reference configuration");
      await send(
        await sdk.partner.createConfig({
          ...defaultCurve(
            stock.symbol,
            Number(current.migrationQuoteThreshold.toString()) /
              10 ** stock.decimals,
            "mainnet-beta",
          ),
          config: configAddress,
          payer: wallet.publicKey,
          feeClaimer: wallet.publicKey,
          leftoverReceiver: wallet.publicKey,
          quoteMint: new PublicKey(stock.mint),
          tokenBadge: stock.badge ? new PublicKey(stock.badge) : undefined,
        }),
        [configKey],
      );
      const config = await sdk.state.getPoolConfig(configAddress),
        mint = Keypair.generate();
      if (
        !config ||
        config.tokenType !== 1 ||
        !config.migrationQuoteThreshold.eq(current.migrationQuoteThreshold)
      )
        throw new Error("Replacement config mismatch");
      steps.push("token2022-config");
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
            tokenBadge: stock.badge ? new PublicKey(stock.badge) : undefined,
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
      const mintAccount = await getMint(
        rpc,
        mint.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      const metadata = await getTokenMetadata(
        rpc,
        mint.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      if (
        mintAccount.mintAuthority ||
        mintAccount.freezeAuthority ||
        mintAccount.supply !== 1_000_000_000_000_000n ||
        !metadata ||
        metadata.symbol !== "LOCAL" ||
        (metadata.updateAuthority &&
          !metadata.updateAuthority.equals(PublicKey.default))
      )
        throw new Error("Mint/metadata authority or supply mismatch");
      steps.push("launch-and-first-buy", "immutable-token2022-metadata");
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
          tokenBDecimal: stock.decimals,
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
      ".data/mainnet-fork/token2022-results.json",
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
