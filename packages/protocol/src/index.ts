export {
  readEventReceipt,
  jsonEventReceipt,
  versionOneEventReceipt,
  type EventReceipt,
} from "./event-receipt";
import { rpcFetch } from "./rpc-fetch";
import { chainPoint } from "./clock";
import { solanaNetwork, GENESIS_HASHES, publicRpc } from "@oneonly/core";
import { Connection, PublicKey, Transaction, Keypair } from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  buildCurve,
  TokenType,
  TokenDecimal,
  TokenAuthorityOption,
  BaseFeeMode,
  CollectFeeMode,
  MigrationOption,
  MigrationFeeOption,
  MigratedCollectFeeMode,
  DammV2DynamicFeeMode,
  DammV2BaseFeeMode,
  ActivationType,
  SwapMode,
  deriveDbcPoolAddress,
  getPriceFromSqrtPrice,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  deriveDammV2PoolAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { EventParser } from "@coral-xyz/anchor";
import {
  CpAmm,
  CP_AMM_PROGRAM_ID,
  SwapMode as DammSwapMode,
  getTokenProgram,
} from "@meteora-ag/cp-amm-sdk";
import BN from "bn.js";
import bs58 from "bs58";
import {
  getMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { QUOTE_MINTS, quoteAssets, quoteAsset } from "./quote-assets";
import { MAINNET_STOCKS } from "./mainnet-stocks";
import { MAINNET_TOKENS } from "./mainnet-tokens";
export { MAINNET_TOKENS, tokenSetupThreshold } from "./mainnet-tokens";
import { inspectStockSetup } from "./stock-setup";
export { MAINNET_STOCKS } from "./mainnet-stocks";
export { inspectStockSetup } from "./stock-setup";
export {
  QUOTE_MINTS,
  USDC_MINTS,
  quoteAssets,
  quoteAsset,
} from "./quote-assets";
export {
  Transaction,
  Keypair,
  PublicKey,
  BN,
  deriveDbcPoolAddress,
  getPriceFromSqrtPrice,
};
export class ProtocolError extends Error {}
export const NETWORK = solanaNetwork(process.env.SOLANA_NETWORK);
export const PROGRAM = new PublicKey(
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
);
export type Quote = string;
let rpcInstance: { url: string; connection: Connection } | undefined;
export function connection() {
  const url = process.env.SOLANA_RPC_URL || publicRpc(NETWORK);
  if (rpcInstance?.url === url) return rpcInstance.connection;
  const rpc = new Connection(url, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: rpcFetch,
  });
  rpcInstance = { url, connection: rpc };
  return rpc;
}
export function client() {
  return new DynamicBondingCurveClient(connection(), "confirmed");
}
export function dammClient() {
  return new CpAmm(connection());
}
const mintCache = new Map<string, Awaited<ReturnType<typeof getMint>>>();
export async function quoteMintInfo(mint: PublicKey) {
  const key = mint.toBase58();
  const stock =
    NETWORK === "mainnet-beta" &&
    MAINNET_STOCKS.find((asset) => asset.mint === key);
  // Issuer extensions are mutable: inspect them and both venue approvals on every preparation.
  if (stock) return (await inspectStockSetup(connection(), stock.symbol)).info;
  const cached = mintCache.get(key);
  if (cached) return cached;
  const account = await connection().getAccountInfo(mint);
  if (
    !account ||
    (!account.owner.equals(TOKEN_PROGRAM_ID) &&
      !account.owner.equals(TOKEN_2022_PROGRAM_ID))
  )
    throw new ProtocolError("Quote mint is unavailable on the active network.");
  const info = await getMint(connection(), mint, "confirmed", account.owner);
  // Extensions require provider-specific fee/hook handling. Fail closed until enabled deliberately.
  if (info.tlvData.length)
    throw new ProtocolError("This quote mint requires an extension adapter.");
  mintCache.set(key, info);
  return info;
}

/** Current UI scale is independent of whether a pair has been opened for trading. */
export async function quoteMultiplier(symbol: string) {
  if (
    NETWORK !== "mainnet-beta" ||
    !MAINNET_STOCKS.some((asset) => asset.symbol === symbol)
  )
    return 1;
  return (await inspectStockSetup(connection(), symbol)).multiplier;
}

/** Derive the official migration destination, never an arbitrary pool with the same mint. */
export async function tradingPool(poolAddress: string) {
  const sdk = client(),
    virtual = await sdk.state.getPool(poolAddress);
  if (!virtual) throw new ProtocolError("Pool is not available.");
  const config = await sdk.state.getPoolConfig(virtual.poolState.config);
  if (!config) throw new ProtocolError("Pool configuration is missing.");
  await quoteMintInfo(config.quoteMint);
  const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption];
  if (config.migrationOption !== MigrationOption.MET_DAMM_V2 || !dammConfig)
    throw new ProtocolError(
      "This pool uses an unsupported migration destination.",
    );
  const address = deriveDammV2PoolAddress(
    dammConfig,
    virtual.poolState.baseMint,
    config.quoteMint,
  );
  const graduated = !!virtual.poolState.isMigrated;
  const state = graduated ? await dammClient().fetchPoolState(address) : null;
  if (
    state &&
    (!state.tokenAMint.equals(virtual.poolState.baseMint) ||
      !state.tokenBMint.equals(config.quoteMint))
  )
    throw new ProtocolError(
      "Graduated pool assets do not match the original curve.",
    );
  return {
    virtual,
    config,
    address,
    dammConfig,
    state,
    readyToMigrate:
      !graduated &&
      virtual.poolState.quoteReserve.gte(config.migrationQuoteThreshold),
  };
}
export async function buildMigration(pool: string, wallet: string) {
  await assertNetwork();
  const market = await tradingPool(pool);
  if (market.state) throw new ProtocolError("This pool has already graduated.");
  if (!market.readyToMigrate)
    throw new ProtocolError(
      "The curve has not reached its graduation threshold.",
    );
  if (
    !market.config.lockedVestingConfig.amountPerPeriod.isZero() ||
    !market.config.lockedVestingConfig.cliffUnlockAmount.isZero()
  )
    throw new ProtocolError(
      "This pool requires a vesting migration before graduation.",
    );
  return client().migration.migrateToDammV2({
    payer: new PublicKey(wallet),
    pool: new PublicKey(pool),
    dammConfig: market.dammConfig,
  });
}
export async function buildDammClaim(pool: string, wallet: string) {
  await assertNetwork();
  const { state, address } = await tradingPool(pool);
  if (!state) throw new ProtocolError("This pool has not graduated.");
  const sdk = dammClient(),
    owner = new PublicKey(wallet);
  const positions = await sdk.getUserPositionByPool(address, owner);
  if (!positions.length)
    throw new ProtocolError("No liquidity position belongs to this wallet.");
  // One position per reviewed transaction keeps wallet payloads bounded.
  const position = positions[0];
  return sdk.claimPositionFee2({
    owner,
    receiver: owner,
    pool: address,
    position: position.position,
    positionNftAccount: position.positionNftAccount,
    tokenAMint: state.tokenAMint,
    tokenBMint: state.tokenBMint,
    tokenAVault: state.tokenAVault,
    tokenBVault: state.tokenBVault,
    tokenAProgram: getTokenProgram(state.tokenAFlag),
    tokenBProgram: getTokenProgram(state.tokenBFlag),
  });
}
export async function assertNetwork() {
  if ((await connection().getGenesisHash()) !== GENESIS_HASHES[NETWORK])
    throw new ProtocolError(`The RPC must connect to Solana ${NETWORK}.`);
}
/** Test-only scripts must never sign with their test wallet on mainnet. */
export async function assertDevnet() {
  if (NETWORK !== "devnet")
    throw new ProtocolError("This test runs only on devnet.");
  await assertNetwork();
}
export function configAddress(quote: Quote) {
  const value = quoteAsset(quote).config;
  return value ? new PublicKey(value) : null;
}
export async function configuredPool(quote: Quote) {
  const address = configAddress(quote);
  if (!address)
    throw new ProtocolError(
      `${quote} launches are awaiting a ${NETWORK} pool configuration.`,
    );
  await assertNetwork();
  const config = await client().state.getPoolConfig(address);
  if (NETWORK === "mainnet-beta") {
    const receiver = process.env.ONEONLY_FEE_WALLET;
    if (
      !receiver ||
      !config ||
      config.feeClaimer.toBase58() !== receiver ||
      config.leftoverReceiver.toBase58() !== receiver
    )
      throw new ProtocolError("Platform fee receiver has not been verified.");
  }
  if (
    !config ||
    config.quoteMint.toBase58() !== quoteAsset(quote).mint ||
    (await quoteMintInfo(config.quoteMint)).decimals !==
      quoteAsset(quote).decimals
  )
    throw new ProtocolError(
      "Pool configuration does not match the selected network and quote asset.",
    );
  if (
    config.tokenDecimal !== 6 ||
    config.tokenType !==
      (quoteAsset(quote).launchTokenType ?? TokenType.SPLToken) ||
    config.tokenUpdateAuthority !== TokenAuthorityOption.Immutable ||
    !config.preMigrationTokenSupply.eq(new BN("1000000000000000")) ||
    !config.postMigrationTokenSupply.eq(new BN("1000000000000000")) ||
    config.creatorTradingFeePercentage !== 50 ||
    config.collectFeeMode !== CollectFeeMode.QuoteToken ||
    !config.poolFees.baseFee.cliffFeeNumerator.eq(new BN("12500000")) ||
    config.poolFees.baseFee.firstFactor !== 0 ||
    config.poolFees.dynamicFee.initialized !== 0 ||
    config.migrationOption !== MigrationOption.MET_DAMM_V2 ||
    (NETWORK === "mainnet-beta"
      ? config.migrationFeeOption !== MigrationFeeOption.Customizable ||
        config.migratedPoolFeeBps !== 125 ||
        config.migratedCollectFeeMode !== MigratedCollectFeeMode.QuoteToken ||
        config.migratedDynamicFee !== DammV2DynamicFeeMode.Disabled ||
        config.migratedPoolBaseFeeMode !==
          DammV2BaseFeeMode.FeeTimeSchedulerLinear ||
        config.migratedCompoundingFeeBps !== 0
      : config.migrationFeeOption !== MigrationFeeOption.FixedBps100) ||
    config.creatorPermanentLockedLiquidityPercentage !== 50 ||
    config.partnerPermanentLockedLiquidityPercentage !== 50 ||
    !config.poolCreationFee.isZero()
  )
    throw new ProtocolError(
      "Pool configuration does not match One Only’s published token supply and fees.",
    );
  return { address, config };
}
export function defaultCurve(
  quote: string,
  migrationQuoteThreshold = quote === "SOL"
    ? 85
    : quote === "USDC"
      ? 10_000
      : (MAINNET_STOCKS.find((asset) => asset.symbol === quote)
          ?.setupThreshold ?? 0),
  network = NETWORK,
  tokenType: TokenType = network === "mainnet-beta"
    ? TokenType.Token2022
    : TokenType.SPLToken,
) {
  const stock =
    network === "mainnet-beta"
      ? MAINNET_STOCKS.find((asset) => asset.symbol === quote)
      : undefined;
  const token =
    network === "mainnet-beta" &&
    MAINNET_TOKENS.find((asset) => asset.symbol === quote);
  if (quote !== "SOL" && quote !== "USDC" && !stock && !token)
    throw new ProtocolError("Unsupported configuration quote.");
  if (!Number.isFinite(migrationQuoteThreshold) || migrationQuoteThreshold <= 0)
    throw new ProtocolError(
      "A positive fixed graduation threshold is required.",
    );
  return buildCurve({
    token: {
      tokenType,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: stock
        ? TokenDecimal.EIGHT
        : quote === "SOL"
          ? TokenDecimal.NINE
          : TokenDecimal.SIX,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: 125,
          endingFeeBps: 125,
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 50,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      // Preserve existing devnet fixtures; new mainnet pools follow the published 1.25% fee.
      migrationFeeOption:
        network === "mainnet-beta"
          ? MigrationFeeOption.Customizable
          : MigrationFeeOption.FixedBps100,
      ...(network === "mainnet-beta"
        ? {
            migratedPoolFee: {
              collectFeeMode: MigratedCollectFeeMode.QuoteToken,
              dynamicFee: DammV2DynamicFeeMode.Disabled,
              poolFeeBps: 125,
              baseFeeMode: DammV2BaseFeeMode.FeeTimeSchedulerLinear,
              compoundingFeeBps: 0,
            },
          }
        : {}),
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage: 50,
      creatorLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 50,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    percentageSupplyOnMigration: 20,
    migrationQuoteThreshold,
  });
}
export async function createLaunch(args: {
  wallet: string;
  mint: Keypair;
  quote: Quote;
  name: string;
  ticker: string;
  uri: string;
  amount: bigint;
  slippageBps: number;
}) {
  const { address, config } = await configuredPool(args.quote),
    sdk = client(),
    owner = new PublicKey(args.wallet);
  const createPoolParam = {
    baseMint: args.mint.publicKey,
    tokenBadge:
      NETWORK === "mainnet-beta" &&
      MAINNET_STOCKS.some((asset) => asset.symbol === args.quote)
        ? new PublicKey(
            MAINNET_STOCKS.find((asset) => asset.symbol === args.quote)!.badge,
          )
        : undefined,
    config: address,
    name: args.name,
    symbol: args.ticker,
    uri: args.uri,
    payer: owner,
    poolCreator: owner,
  };
  const pool = deriveDbcPoolAddress(
    new PublicKey(quoteAsset(args.quote).mint),
    args.mint.publicKey,
    address,
  ).toBase58();
  if (args.amount < 0n)
    throw new ProtocolError("First buy cannot be negative.");
  if (args.amount === 0n) {
    return {
      transaction: await sdk.creator.createPool(createPoolParam),
      config: address.toBase58(),
      pool,
      minimumOut: "0",
    };
  }
  const quote = sdk.pool.getQuoteFromInputAmount({
    config,
    swapBaseForQuote: false,
    amountIn: new BN(args.amount.toString()),
    slippageBps: args.slippageBps,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    swapMode: SwapMode.ExactIn,
  });
  if (
    !quote.minimumAmountOut ||
    quote.minimumAmountOut.lten(0) ||
    !quote.amountLeft.isZero()
  )
    throw new ProtocolError("First buy cannot be filled on this curve.");
  const transaction = await sdk.creator.createPoolWithFirstBuy({
    createPoolParam,
    firstBuyParam: {
      buyer: owner,
      receiver: owner,
      buyAmount: new BN(args.amount.toString()),
      minimumAmountOut: quote.minimumAmountOut,
      referralTokenAccount: null,
    },
  });
  return {
    transaction,
    config: address.toBase58(),
    pool,
    minimumOut: quote.minimumAmountOut.toString(),
  };
}
export async function quoteSwap(
  poolAddress: string,
  amount: bigint,
  sell: boolean,
  slippageBps: number,
) {
  await assertNetwork();
  const sdk = client(),
    market = await tradingPool(poolAddress),
    { virtual: pool, config, state } = market;
  if (state) {
    const quote = dammClient().getQuote2({
      poolState: state,
      inputTokenMint: sell ? state.tokenAMint : state.tokenBMint,
      amountIn: new BN(amount.toString()),
      swapMode: DammSwapMode.ExactIn,
      slippage: slippageBps,
      hasReferral: false,
      currentPoint: await chainPoint(connection(), state.activationType),
      tokenADecimal: config.tokenDecimal,
      tokenBDecimal: (await quoteMintInfo(config.quoteMint)).decimals,
    });
    if (
      !quote.minimumAmountOut?.gtn(0) ||
      !quote.includedFeeInputAmount.eq(new BN(amount.toString()))
    )
      throw new ProtocolError(
        "This amount cannot be fully filled. Try a smaller trade.",
      );
    return {
      out: quote.outputAmount.toString(),
      minimumOut: quote.minimumAmountOut.toString(),
      fee: quote.claimingFee
        .add(quote.compoundingFee)
        .add(quote.protocolFee)
        .toString(),
      venue: "damm-v2" as const,
      pool: market.address.toBase58(),
      priceImpact: quote.priceImpact.toString(),
      consumedInput: amount.toString(),
    };
  }
  if (market.readyToMigrate)
    throw new ProtocolError(
      "The curve is complete. Finish graduation to resume trading.",
    );
  const quote = sdk.pool.swapQuote2({
    swapMode: sell ? SwapMode.ExactIn : SwapMode.PartialFill,
    virtualPool: pool,
    config,
    swapBaseForQuote: sell,
    amountIn: new BN(amount.toString()),
    slippageBps,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    currentPoint: await chainPoint(connection(), config.activationType),
  });
  if (
    !quote.minimumAmountOut ||
    quote.minimumAmountOut.lten(0) ||
    (sell && !quote.amountLeft.isZero())
  )
    throw new ProtocolError(
      "This amount cannot be fully filled. Try a smaller trade.",
    );
  return {
    out: quote.outputAmount.toString(),
    minimumOut: quote.minimumAmountOut.toString(),
    fee: quote.tradingFee.add(quote.protocolFee).toString(),
    venue: "dbc" as const,
    pool: poolAddress,
    consumedInput: quote.includedFeeInputAmount.toString(),
  };
}
export async function buildSwap(args: {
  pool: string;
  wallet: string;
  amount: bigint;
  sell: boolean;
  minimumOut: string;
  venue?: "dbc" | "damm-v2";
}) {
  const market = await tradingPool(args.pool);
  if ((market.state ? "damm-v2" : "dbc") !== (args.venue ?? "dbc"))
    throw new ProtocolError(
      "The pool graduated while preparing this trade. Request a fresh quote.",
    );
  if (market.state) {
    const state = market.state;
    return dammClient().swap2({
      pool: market.address,
      poolState: state,
      payer: new PublicKey(args.wallet),
      inputTokenMint: args.sell ? state.tokenAMint : state.tokenBMint,
      outputTokenMint: args.sell ? state.tokenBMint : state.tokenAMint,
      tokenAMint: state.tokenAMint,
      tokenBMint: state.tokenBMint,
      tokenAVault: state.tokenAVault,
      tokenBVault: state.tokenBVault,
      tokenAProgram: getTokenProgram(state.tokenAFlag),
      tokenBProgram: getTokenProgram(state.tokenBFlag),
      amountIn: new BN(args.amount.toString()),
      minimumAmountOut: new BN(args.minimumOut),
      swapMode: DammSwapMode.ExactIn,
      referralTokenAccount: null,
    });
  }
  return client().pool.swap2({
    pool: new PublicKey(args.pool),
    owner: new PublicKey(args.wallet),
    swapBaseForQuote: args.sell,
    amountIn: new BN(args.amount.toString()),
    minimumAmountOut: new BN(args.minimumOut),
    swapMode: args.sell ? SwapMode.ExactIn : SwapMode.PartialFill,
    referralTokenAccount: null,
  });
}
export async function buildClaim(pool: string, wallet: string) {
  await assertNetwork();
  await tradingPool(pool);
  const owner = new PublicKey(wallet),
    max = new BN("18446744073709551615");
  return client().creator.claimCreatorTradingFee({
    pool: new PublicKey(pool),
    creator: owner,
    payer: owner,
    maxBaseAmount: max,
    maxQuoteAmount: max,
  });
}
export const eventParser = () =>
  new EventParser(PROGRAM, client().state.program.coder);

/** Current DBC versions emit Anchor events through self-CPI, not Program data logs. */
export function decodeTransactionEvents(
  transaction: import("./event-receipt").EventReceipt,
  venue: "dbc" | "damm-v2" = "dbc",
) {
  const coder =
    venue === "dbc"
      ? client().state.program.coder
      : dammClient()._program.coder;
  const program = venue === "dbc" ? PROGRAM : CP_AMM_PROGRAM_ID;
  const keys = transaction.transaction.message.getAccountKeys({
    accountKeysFromLookups: transaction.meta?.loadedAddresses,
  });
  const events = [];
  for (const group of transaction.meta?.innerInstructions ?? [])
    for (const instruction of group.instructions) {
      if (!keys.get(instruction.programIdIndex)?.equals(program)) continue;
      const bytes = bs58.decode(instruction.data);
      if (Buffer.from(bytes.slice(0, 8)).toString("hex") !== "e445a52e51cb9a1d")
        continue;
      const event = coder.events.decode(
        Buffer.from(bytes.slice(8)).toString("base64"),
      );
      if (event) events.push(event);
    }
  return events.length
    ? events
    : [
        ...new EventParser(program, coder).parseLogs(
          transaction.meta?.logMessages ?? [],
        ),
      ];
}

/** swap2 emits the legacy event immediately before its v2 event. Count the pair once. */
export function canonicalSwapEvents(
  events: ReturnType<typeof decodeTransactionEvents>,
) {
  return events.filter((event, index) => {
    if (event.name !== "evtSwap" || events[index + 1]?.name !== "evtSwap2")
      return true;
    const next = events[index + 1].data,
      current = event.data;
    return !(
      current.pool.toString() === next.pool.toString() &&
      current.tradeDirection === next.tradeDirection &&
      current.amountIn.toString() ===
        next.swapResult.includedFeeInputAmount.toString() &&
      current.swapResult.outputAmount.toString() ===
        next.swapResult.outputAmount.toString()
    );
  });
}

export {
  decodeWalletTransaction,
  transactionMessage,
  verifyWalletTransaction,
  prepareTransactionWire,
  reviewWalletFeeChange,
  validateWalletFeeChange,
  isLegacyTransaction,
  type WalletTransaction,
} from "./wire";
export { hasWalletSafetyAssertions } from "./wire";

export { jupiterRoute, routeLookupTables } from "./jupiter";
export { intermediateSolInstructions } from "./route-composition";

export async function quoteProgram(mint: PublicKey) {
  const account = await connection().getAccountInfo(mint);
  if (
    !account ||
    ![TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].some((program) =>
      program.equals(account.owner),
    )
  )
    throw new ProtocolError("Quote token program is unavailable.");
  return account.owner;
}

export { verifiedPurchase } from "./purchase";
