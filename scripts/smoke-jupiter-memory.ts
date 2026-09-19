import { hydrateMemoryRoute } from "./hydrate-memory-route";
import { readFile, writeFile } from "node:fs/promises";
import {
  DynamicBondingCurveClient,
  SwapMode,
  deriveDbcPoolAddress,
  getCurrentPoint,
} from "../packages/protocol/node_modules/@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "../packages/protocol/node_modules/bn.js";
import { Keypair } from "../packages/protocol/node_modules/@solana/web3.js";
import { memoryChain } from "./memory-chain";
import { validateJupiterRoute } from "../packages/protocol/src/jupiter";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "../packages/protocol/node_modules/@solana/spl-token";
import {
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
  PublicKey,
} from "../packages/protocol/node_modules/@solana/web3.js";
async function main() {
  const { wallet, rpc, svm, send } = await memoryChain();
  const data = JSON.parse(
    await readFile(".data/mainnet-fork/jupiter-build.json", "utf8"),
  );
  const route = validateJupiterRoute(data, {
    wallet: wallet.publicKey.toBase58(),
    inputMint: data.inputMint,
    outputMint: data.outputMint,
    amount: BigInt(data.inAmount),
    slippageBps: data.slippageBps,
    inputProgram: TOKEN_PROGRAM_ID,
    outputProgram: TOKEN_2022_PROGRAM_ID,
  });
  const tables = route.lookupAddresses.map((key) => {
    const account = svm.getAccount(key as any);
    if (!account.exists) throw new Error("Missing table fixture");
    return new AddressLookupTableAccount({
      key: new PublicKey(key),
      state: AddressLookupTableAccount.deserialize(account.data),
    });
  });
  const output = getAssociatedTokenAddressSync(
    new PublicKey(data.outputMint),
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  ).toBase58();
  const amount = () => {
    const account = svm.getAccount(output as any);
    return account.exists ? Buffer.from(account.data).readBigUInt64LE(64) : 0n;
  };
  const sdk = new DynamicBondingCurveClient(rpc, "confirmed");
  const configs = JSON.parse(
    await readFile(".data/mainnet/confirmed-stock-configs.json", "utf8"),
  );
  const configAddress = new PublicKey(
      configs.find((item) => item.symbol === "SPYX").address,
    ),
    config = await sdk.state.getPoolConfig(configAddress),
    mint = Keypair.generate();
  const stock = (await import("../packages/protocol/src/mainnet-stocks"))
    .MAINNET_STOCKS[0];
  const pool = deriveDbcPoolAddress(
    new PublicKey(stock.mint),
    mint.publicKey,
    configAddress,
  );
  const firstAmount = new BN(14_000_000);
  const initial = sdk.pool.getQuoteFromInputAmount({
    config,
    swapBaseForQuote: false,
    amountIn: firstAmount,
    slippageBps: 50,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    swapMode: SwapMode.ExactIn,
  });
  await send(
    await sdk.creator.createPoolWithFirstBuy({
      createPoolParam: {
        config: configAddress,
        baseMint: mint.publicKey,
        tokenBadge: new PublicKey(stock.badge),
        name: "Local routed trade",
        symbol: "ROUTE",
        uri: "https://app.oneonly.lol",
        payer: wallet.publicKey,
        poolCreator: wallet.publicKey,
      },
      firstBuyParam: {
        buyer: wallet.publicKey,
        receiver: wallet.publicKey,
        buyAmount: firstAmount,
        minimumAmountOut: initial.minimumAmountOut,
        referralTokenAccount: null,
      },
    }),
    [mint],
  );
  const virtualPool = await sdk.state.getPool(pool);
  const poolQuote = sdk.pool.swapQuote2({
    virtualPool,
    config,
    swapBaseForQuote: false,
    amountIn: new BN(route.minimumOut.toString()),
    slippageBps: 50,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    swapMode: SwapMode.PartialFill,
    currentPoint: await getCurrentPoint(rpc, config.activationType),
  });
  const poolTx = await sdk.pool.swap2({
    pool,
    owner: wallet.publicKey,
    swapBaseForQuote: false,
    amountIn: new BN(route.minimumOut.toString()),
    minimumAmountOut: poolQuote.minimumAmountOut,
    swapMode: SwapMode.PartialFill,
    referralTokenAccount: null,
  });
  const baseAccount = getAssociatedTokenAddressSync(
    mint.publicKey,
    wallet.publicKey,
  ).toBase58();
  const baseBalance = () => {
    const a = svm.getAccount(baseAccount as any);
    return a.exists ? Buffer.from(a.data).readBigUInt64LE(64) : 0n;
  };
  const baseBefore = baseBalance();
  const before = amount();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: svm.latestBlockhash(),
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
        ...route.setup,
        route.swap,
        ...poolTx.instructions,
        ...route.cleanup,
      ],
    }).compileToV0Message(tables),
  );
  if (tx.serialize().length > 1232)
    throw new Error("Combined route exceeds packet limit");
  await send(tx);
  const received = amount() - before;
  if (
    baseBalance() - baseBefore <
    BigInt(poolQuote.minimumAmountOut.toString())
  )
    throw new Error("Combined token output below reviewed minimum");
  await writeFile(
    ".data/mainnet-fork/jupiter-result.json",
    JSON.stringify(
      {
        passed: true,
        execution: "in-memory only",
        inputAtoms: data.inAmount,
        quoteRemainderAtoms: received.toString(),
        receivedBaseAtoms: (baseBalance() - baseBefore).toString(),
        minimumBaseOut: poolQuote.minimumAmountOut.toString(),
        wireBytes: tx.serialize().length,
      },
      null,
      2,
    ),
  );
  console.log(
    "In-memory atomic SOL-to-stock-to-launchpad-token buy passed; output exceeds the reviewed minimum.",
  );
  if (process.env.TEST_REVERSE_ROUTE === "1") {
    const sellAmount = new BN(((baseBalance() - baseBefore) / 2n).toString());
    const sellPool = await sdk.state.getPool(pool);
    const sellQuote = sdk.pool.swapQuote2({
      virtualPool: sellPool,
      config,
      swapBaseForQuote: true,
      amountIn: sellAmount,
      slippageBps: 50,
      hasReferral: false,
      eligibleForFirstSwapWithMinFee: false,
      swapMode: SwapMode.ExactIn,
      currentPoint: await getCurrentPoint(rpc, config.activationType),
    });
    const params = new URLSearchParams({
      inputMint: stock.mint,
      outputMint: data.inputMint,
      amount: sellQuote.minimumAmountOut.toString(),
      taker: wallet.publicKey.toBase58(),
      slippageBps: "50",
      maxAccounts: "32",
      dexes: "Kipseli,Riptide",
    });
    const response = await fetch(`https://api.jup.ag/swap/v2/build?${params}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("Reverse quote unavailable");
    const reverseData = await response.json();
    await writeFile(
      ".data/mainnet-fork/jupiter-reverse-build.json",
      JSON.stringify(reverseData, null, 2),
    );
    const reverse = validateJupiterRoute(reverseData, {
      wallet: wallet.publicKey.toBase58(),
      inputMint: stock.mint,
      outputMint: data.inputMint,
      amount: BigInt(sellQuote.minimumAmountOut.toString()),
      slippageBps: 50,
      inputProgram: TOKEN_2022_PROGRAM_ID,
      outputProgram: TOKEN_PROGRAM_ID,
    });
    await hydrateMemoryRoute(svm, reverseData);
    const sellTx = await sdk.pool.swap2({
      pool,
      owner: wallet.publicKey,
      swapBaseForQuote: true,
      amountIn: sellAmount,
      minimumAmountOut: sellQuote.minimumAmountOut,
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: null,
    });
    const reverseTables = reverse.lookupAddresses.map((key) => {
      const a = svm.getAccount(key as any);
      if (!a.exists) throw new Error("Missing reverse table");
      return new AddressLookupTableAccount({
        key: new PublicKey(key),
        state: AddressLookupTableAccount.deserialize(a.data),
      });
    });
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: svm.latestBlockhash(),
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
          ...reverse.setup,
          ...sellTx.instructions,
          reverse.swap,
          ...reverse.cleanup,
        ],
      }).compileToV0Message(reverseTables),
    );
    if (tx.serialize().length > 1232)
      throw new Error("Reverse route exceeds packet limit");
    await send(tx);
    await writeFile(
      ".data/mainnet-fork/jupiter-reverse-result.json",
      JSON.stringify(
        {
          passed: true,
          execution: "in-memory only",
          inputBaseAtoms: sellAmount.toString(),
          minimumSolAtoms: reverse.minimumOut.toString(),
          wireBytes: tx.serialize().length,
        },
        null,
        2,
      ),
    );
    console.log(
      "Atomic launchpad-token-to-stock-to-SOL sell passed in memory.",
    );
  }
}
main().catch((error) => {
  console.error(error.message);
  if (error.logs) console.error(error.logs.slice(-20).join("\n"));
  process.exitCode = 1;
});
