import { deriveDammV1MigrationMetadataAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  allocationAddress,
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
  if (NETWORK !== "devnet")
    throw new ProtocolError("Fee sharing is in devnet preview.");
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
  const market = await tradingPool(pool),
    allocation = allocationAddress(new PublicKey(pool), program);
  if (!market.virtual.poolState.creator.equals(allocation))
    throw new ProtocolError("Pool fees are not owned by the escrow.");
  const positions = market.state
    ? await dammClient().getUserPositionByPool(market.address, allocation)
    : [];
  if (market.state && positions.length !== 1)
    throw new ProtocolError(
      "The graduated creator position could not be verified.",
    );
  const fees = market.state
    ? getUnClaimLpFee(market.state, positions[0].positionState)
    : null;
  return {
    ...market,
    allocation,
    positions,
    pendingDbc: {
      base: BigInt(market.virtual.poolState.creatorBaseFee.toString()),
      quote: BigInt(market.virtual.poolState.creatorQuoteFee.toString()),
    },
    pendingDamm: {
      base: BigInt(fees?.feeTokenA.toString() ?? "0"),
      quote: BigInt(fees?.feeTokenB.toString() ?? "0"),
    },
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
