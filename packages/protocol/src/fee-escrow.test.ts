import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  NATIVE_MINT,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  DynamicBondingCurveClient,
  deriveDammV1MigrationMetadataAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm, CP_AMM_PROGRAM_ID } from "@meteora-ag/cp-amm-sdk";
import BN from "bn.js";
import { allocationAddress, discriminator } from "@oneonly/fee-escrow";
const mock = vi.hoisted(() => ({
  network: "devnet",
  rpc: undefined as unknown,
  dbc: undefined as unknown,
  damm: undefined as unknown,
  market: vi.fn(),
}));
vi.mock("./index", async () => ({
  ...(await import("@solana/web3.js")),
  BN: (await import("bn.js")).default,
  get NETWORK() {
    return mock.network;
  },
  PROGRAM: new (await import("@solana/web3.js")).PublicKey(
    "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
  ),
  ProtocolError: class extends Error {},
  connection: () => mock.rpc,
  client: () => mock.dbc,
  dammClient: () => mock.damm,
  tradingPool: mock.market,
}));
import { appendFeeAllocation, buildFeeCollection } from "./fee-escrow";
const key = () => Keypair.generate().publicKey;
const program = key(),
  pool = key(),
  wallet = key(),
  config = key(),
  base = key(),
  baseVault = key(),
  quoteVault = key(),
  dammPool = key(),
  position = key(),
  nft = key();
const allocation = allocationAddress(pool, program),
  dbcProgram = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
let rpc: Connection, dbc: DynamicBondingCurveClient, damm: CpAmm;
beforeEach(() => {
  vi.restoreAllMocks();
  mock.network = "devnet";
  rpc = new Connection("https://api.devnet.solana.com");
  vi.spyOn(rpc, "getAccountInfo").mockResolvedValue(null);
  vi.spyOn(rpc, "getMultipleAccountsInfo").mockResolvedValue([
    {
      owner: TOKEN_2022_PROGRAM_ID,
      data: Buffer.alloc(82),
      executable: false,
      lamports: 1,
      rentEpoch: 0,
    },
    {
      owner: TOKEN_PROGRAM_ID,
      data: Buffer.alloc(82),
      executable: false,
      lamports: 1,
      rentEpoch: 0,
    },
  ]);
  dbc = new DynamicBondingCurveClient(rpc, "confirmed");
  damm = new CpAmm(rpc);
  mock.rpc = rpc;
  mock.dbc = dbc;
  mock.damm = damm;
});
afterEach(() => vi.restoreAllMocks());
function market(quote: PublicKey, graduated = false) {
  const virtual = {
    poolState: {
      baseMint: base,
      baseVault,
      quoteVault,
      creator: allocation,
      creatorBaseFee: new BN(12),
      creatorQuoteFee: new BN(34),
    },
  };
  const cfg = { quoteMint: quote, tokenType: 1, quoteTokenFlag: 0 };
  const state = graduated
    ? {
        tokenAVault: baseVault,
        tokenBVault: quoteVault,
        tokenAFlag: 1,
        tokenBFlag: 0,
        feeAPerLiquidity: Array(32).fill(0),
        feeBPerLiquidity: Array(32).fill(0),
      }
    : null;
  mock.market.mockResolvedValue({
    virtual,
    config: cfg,
    state,
    address: graduated ? dammPool : pool,
  });
  vi.spyOn(
    dbc.creator as unknown as {
      getPoolWithConfig: (p: PublicKey) => Promise<unknown>;
    },
    "getPoolWithConfig",
  ).mockResolvedValue({ virtualPool: virtual, poolConfigState: cfg });
  vi.spyOn(damm, "getUserPositionByPool").mockResolvedValue([
    {
      position,
      positionNftAccount: nft,
      positionState: {
        unlockedLiquidity: new BN(0),
        vestedLiquidity: new BN(0),
        permanentLockedLiquidity: new BN(0),
        feeAPerTokenCheckpoint: Array(32).fill(0),
        feeBPerTokenCheckpoint: Array(32).fill(0),
        feeAPending: new BN(56),
        feeBPending: new BN(78),
        rewardInfos: [],
      },
    },
  ] as never);
}
it("appends an allocation before the pool exists without trying to fetch it", async () => {
  vi.mocked(rpc.getAccountInfo).mockRejectedValue(
    new Error("Pool does not exist yet"),
  );
  const tx = new Transaction();
  expect(
    await appendFeeAllocation(tx, {
      wallet: wallet.toBase58(),
      pool: pool.toBase58(),
      config: config.toBase58(),
      mint: base.toBase58(),
      quoteMint: NATIVE_MINT.toBase58(),
      program,
      recipients: [{ xId: "12345", shareBps: 10000 }],
    }),
  ).toEqual(allocation);
  expect(rpc.getAccountInfo).not.toHaveBeenCalled();
  expect(rpc.getMultipleAccountsInfo).not.toHaveBeenCalled();
  expect(tx.instructions).toHaveLength(1);
  const ix = tx.instructions[0];
  expect(ix.programId).toEqual(program);
  expect(ix.data.subarray(0, 8)).toEqual(
    discriminator("global", "initialize_allocation"),
  );
  expect(ix.data.readUInt32LE(8)).toBe(1);
  expect(ix.keys[0].pubkey).toEqual(wallet);
  expect(ix.keys[2].pubkey).toEqual(allocation);
  expect(ix.keys[3].pubkey).toEqual(pool);
  expect(ix.keys[4].pubkey).toEqual(config);
  expect(ix.keys[7].pubkey).toEqual(dbcProgram);
  expect(ix.keys[9].pubkey).toEqual(deriveDammV1MigrationMetadataAddress(pool));
  const transfer = await dbc.state.program.methods
    .transferPoolCreator()
    .accountsPartial({
      virtualPool: pool,
      config,
      creator: wallet,
      newCreator: allocation,
    })
    .remainingAccounts([
      {
        pubkey: deriveDammV1MigrationMetadataAddress(pool),
        isSigner: false,
        isWritable: false,
      },
    ])
    .instruction();
  expect(transfer.programId).toEqual(dbcProgram);
  expect(transfer.data).toEqual(
    Buffer.from([20, 7, 169, 33, 58, 147, 166, 33]),
  );
  expect(transfer.keys).toHaveLength(7);
  expect(transfer.keys.map((k) => k.pubkey)).toEqual([
    pool,
    config,
    wallet,
    allocation,
    ix.keys[8].pubkey,
    dbcProgram,
    ix.keys[9].pubkey,
  ]);
  expect(transfer.keys.map((k) => [k.isSigner, k.isWritable])).toEqual([
    [false, true],
    [false, false],
    [true, false],
    [false, false],
    [false, false],
    [false, false],
    [false, false],
  ]);
  expect(rpc.getAccountInfo).not.toHaveBeenCalled();
});
it.each(["SOL", "USDC"])(
  "uses actual DBC SDK legacy claim layout and escrow ATAs for %s",
  async (quoteName) => {
    const quote = quoteName === "SOL" ? NATIVE_MINT : key();
    market(quote);
    const builder = vi.spyOn(dbc.creator, "claimCreatorTradingFeeToReceiver");
    const outer = await buildFeeCollection(
      pool.toBase58(),
      wallet.toBase58(),
      program,
      "dbc",
    );
    const built = (await builder.mock.results[0].value) as Transaction;
    const ix = built.instructions.find((i) => i.programId.equals(dbcProgram))!;
    expect(ix.keys).toHaveLength(13);
    expect(ix.data).toEqual(
      Buffer.concat([
        Buffer.from([82, 220, 250, 189, 3, 85, 107, 45]),
        Buffer.alloc(16, 255),
      ]),
    );
    expect(ix.keys[1].pubkey).toEqual(pool);
    expect(ix.keys[8].pubkey).toEqual(allocation);
    expect(ix.keys[8].isSigner).toBe(true);
    expect(ix.keys[12].pubkey).toEqual(dbcProgram);
    checkCollection(outer, ix, quote, 0, 2, 3, 6, 7, 9, 10);
  },
);
it.each(["SOL", "USDC"])(
  "uses DAMM legacy15-account claim with explicit escrow WSOL owner for %s",
  async (quoteName) => {
    const quote = quoteName === "SOL" ? NATIVE_MINT : key();
    market(quote, true);
    const builder = vi.spyOn(damm, "claimPositionFee"),
      wrong = vi.spyOn(damm, "claimPositionFee2");
    const outer = await buildFeeCollection(
      pool.toBase58(),
      wallet.toBase58(),
      program,
      "damm-v2",
    );
    expect(wrong).not.toHaveBeenCalled();
    expect(builder.mock.calls[0][0].tempWSolAccount).toEqual(allocation);
    const built = (await builder.mock.results[0].value) as Transaction;
    const ix = built.instructions.find((i) =>
      i.programId.equals(CP_AMM_PROGRAM_ID),
    )!;
    expect(ix.data).toEqual(Buffer.from([180, 38, 154, 17, 133, 33, 162, 211]));
    expect(ix.keys).toHaveLength(15);
    expect(ix.keys[1].pubkey).toEqual(dammPool);
    expect(ix.keys[2].pubkey).toEqual(position);
    expect(ix.keys[9].pubkey).toEqual(nft);
    expect(ix.keys[10].pubkey).toEqual(allocation);
    expect(ix.keys[10].isSigner).toBe(true);
    expect(ix.keys[14].pubkey).toEqual(CP_AMM_PROGRAM_ID);
    checkCollection(outer, ix, quote, 1, 3, 4, 7, 8, 11, 12);
  },
);
function checkCollection(
  outer: Transaction["instructions"][number],
  ix: Transaction["instructions"][number],
  quote: PublicKey,
  venue: number,
  a: number,
  b: number,
  ma: number,
  mb: number,
  pa: number,
  pb: number,
) {
  const baseAta = getAssociatedTokenAddressSync(
      base,
      allocation,
      true,
      TOKEN_2022_PROGRAM_ID,
    ),
    quoteAta = getAssociatedTokenAddressSync(
      quote,
      allocation,
      true,
      TOKEN_PROGRAM_ID,
    );
  expect(ix.keys[a].pubkey).toEqual(baseAta);
  expect(ix.keys[b].pubkey).toEqual(quoteAta);
  expect(ix.keys[ma].pubkey).toEqual(base);
  expect(ix.keys[mb].pubkey).toEqual(quote);
  expect(ix.keys[pa].pubkey).toEqual(TOKEN_2022_PROGRAM_ID);
  expect(ix.keys[pb].pubkey).toEqual(TOKEN_PROGRAM_ID);
  expect(outer.programId).toEqual(program);
  expect(outer.data).toEqual(
    Buffer.concat([
      discriminator("global", "collect_fees"),
      Buffer.from([venue]),
    ]),
  );
  expect(outer.keys).toHaveLength(12 + ix.keys.length);
  expect(outer.keys[6].pubkey).toEqual(baseAta);
  expect(outer.keys[7].pubkey).toEqual(quoteAta);
  expect(outer.keys.slice(12)).toEqual(
    ix.keys.map((k) => ({ ...k, isSigner: false })),
  );
}
it("refuses allocation initialization on mainnet", async () => {
  mock.network = "mainnet-beta";
  await expect(
    appendFeeAllocation(new Transaction(), {
      wallet: wallet.toBase58(),
      pool: pool.toBase58(),
      config: config.toBase58(),
      mint: base.toBase58(),
      quoteMint: NATIVE_MINT.toBase58(),
      program,
      recipients: [{ xId: "12345", shareBps: 10000 }],
    }),
  ).rejects.toThrow("devnet preview");
  expect(rpc.getAccountInfo).not.toHaveBeenCalled();
});
