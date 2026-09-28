import { deriveDammV1MigrationMetadataAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  allocationAddress,
  assertFeeEscrowProgram,
  MAINNET_FEE_ESCROW_PROGRAM,
  collectFeesInstruction,
  initializeAllocationInstruction,
} from "@oneonly/fee-escrow";
import {
  getTokenProgram,
  getUnClaimLpFee,
  CP_AMM_PROGRAM_ID,
} from "@meteora-ag/cp-amm-sdk";
import {
  connection,
  client,
  dammClient,
  tradingPool,
  PublicKey,
  BN,
  PROGRAM,
  NETWORK,
  ProtocolError,
} from "./index";
import type { Transaction, TransactionInstruction } from "@solana/web3.js";
function assertFeeSharingNetwork(program: PublicKey) {
  if (NETWORK === "mainnet-beta") {
    if (
      process.env.ONEONLY_ENVIRONMENT !== "staging" ||
      process.env.STAGING_MAINNET_ENABLED !== "true"
    )
      throw new ProtocolError(
        "Mainnet fee sharing is only available in explicitly enabled staging.",
      );
    assertFeeEscrowProgram(NETWORK, program);
  } else if (program.equals(MAINNET_FEE_ESCROW_PROGRAM)) {
    throw new ProtocolError(
      "Fee escrow program does not match the selected network.",
    );
  }
}
export async function appendFeeAllocation(
  transaction: Transaction,
  args: {
    wallet: string;
    pool: string;
    config: string;
    mint: string;
    quoteMint: string;
    program: PublicKey;
    recipients: { xId: string; shareBps: number }[];
  },
) {
  assertFeeSharingNetwork(args.program);
  const pool = new PublicKey(args.pool),
    payer = new PublicKey(args.wallet),
    allocation = allocationAddress(pool, args.program);
  // The pool is created earlier in this same transaction, so the SDK's
  // transferPoolCreator convenience method cannot fetch it from RPC yet.
  const ix = await client()
    .state.program.methods.transferPoolCreator()
    .accountsPartial({
      virtualPool: pool,
      config: new PublicKey(args.config),
      creator: payer,
      newCreator: allocation,
    })
    .remainingAccounts([
      {
        pubkey: deriveDammV1MigrationMetadataAddress(pool),
        isWritable: false,
        isSigner: false,
      },
    ])
    .instruction();
  transaction.add(
    initializeAllocationInstruction({
      payer,
      pool,
      dbcConfig: new PublicKey(args.config),
      baseMint: new PublicKey(args.mint),
      quoteMint: new PublicKey(args.quoteMint),
      shares: args.recipients,
      transferInstruction: ix,
      program: args.program,
    }),
  );
  return allocation;
}
export async function feeMarket(pool: string, program: PublicKey) {
  assertFeeSharingNetwork(program);
  const market = await tradingPool(pool),
    allocation = allocationAddress(new PublicKey(pool), program);
  if (!market.virtual.poolState.creator.equals(allocation))
    throw new ProtocolError("Pool fees are not owned by the escrow.");
  // Anyone can donate a position NFT to the allocation. The SDK verifies NFT
  // ownership and filters positions to this pool; an exact-count check lets an
  // empty donation block all claims. Include donated fees, as the program does,
  // and select a funded position without relying on RPC/SDK enumeration order.
  const owned = market.state
    ? await dammClient().getUserPositionByPool(market.address, allocation)
    : [];
  const unique = new Map(
    owned.map((position) => [position.position.toBase58(), position]),
  );
  const ranked = [...unique.values()]
    .map((position) => {
      const fees = getUnClaimLpFee(market.state!, position.positionState);
      return {
        position,
        base: BigInt(fees.feeTokenA.toString()),
        quote: BigInt(fees.feeTokenB.toString()),
      };
    })
    .sort((a, b) => {
      if (a.quote !== b.quote) return a.quote > b.quote ? -1 : 1;
      if (a.base !== b.base) return a.base > b.base ? -1 : 1;
      return Buffer.compare(
        a.position.position.toBuffer(),
        b.position.position.toBuffer(),
      );
    });
  const positions = ranked.map(({ position }) => position);
  const pendingDamm = ranked.reduce(
    (total, fees) => ({
      base: total.base + fees.base,
      quote: total.quote + fees.quote,
    }),
    { base: 0n, quote: 0n },
  );
  return {
    ...market,
    allocation,
    positions,
    pendingDbc: {
      base: BigInt(market.virtual.poolState.creatorBaseFee.toString()),
      quote: BigInt(market.virtual.poolState.creatorQuoteFee.toString()),
    },
    pendingDamm,
  };
}
export async function buildFeeCollection(
  pool: string,
  wallet: string,
  program: PublicKey,
  venue: "dbc" | "damm-v2" = "dbc",
) {
  const market = await feeMarket(pool, program),
    baseMint = market.virtual.poolState.baseMint,
    quoteMint = market.config.quoteMint;
  const infos = await connection().getMultipleAccountsInfo([
    baseMint,
    quoteMint,
  ]);
  if (!infos[0] || !infos[1])
    throw new ProtocolError("Pool mints unavailable.");
  let tx: Transaction, source: PublicKey;
  if (venue === "dbc") {
    source = PROGRAM;
    tx = await client().creator.claimCreatorTradingFeeToReceiver({
      creator: market.allocation,
      payer: new PublicKey(wallet),
      receiver: market.allocation,
      pool: new PublicKey(pool),
      maxBaseAmount: new BN("18446744073709551615"),
      maxQuoteAmount: new BN("18446744073709551615"),
    });
  } else {
    if (!market.state) throw new ProtocolError("This pool has not graduated.");
    if (
      !market.positions.length ||
      (market.pendingDamm.base === 0n && market.pendingDamm.quote === 0n)
    )
      throw new ProtocolError(
        "No graduated position fees are available to collect.",
      );
    source = CP_AMM_PROGRAM_ID;
    const position = market.positions[0],
      state = market.state;
    tx = await dammClient().claimPositionFee({
      owner: market.allocation,
      receiver: market.allocation,
      // Keep WSOL in the escrow ATA; only the pinned claim instruction below
      // is used, never the SDK's unwrap/close post-instruction.
      tempWSolAccount: market.allocation,
      feePayer: new PublicKey(wallet),
      pool: market.address,
      position: position.position,
      positionNftAccount: position.positionNftAccount,
      tokenAMint: baseMint,
      tokenBMint: quoteMint,
      tokenAVault: state.tokenAVault,
      tokenBVault: state.tokenBVault,
      tokenAProgram: getTokenProgram(state.tokenAFlag),
      tokenBProgram: getTokenProgram(state.tokenBFlag),
    });
  }
  const matches = tx.instructions.filter((ix) => ix.programId.equals(source));
  if (matches.length !== 1)
    throw new ProtocolError("Unexpected fee collection instruction.");
  return collectFeesInstruction({
    payer: new PublicKey(wallet),
    pool: new PublicKey(pool),
    baseMint,
    quoteMint,
    baseProgram: infos[0].owner,
    quoteProgram: infos[1].owner,
    venue: venue === "dbc" ? 0 : 1,
    meteoraInstruction: matches[0],
    program,
  });
}
