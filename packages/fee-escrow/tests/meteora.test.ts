import { beforeEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AccountLayout,
  MintLayout,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { address, getTransactionDecoder, lamports } from "@solana/kit";
import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { createRequire } from "node:module";
const { cpAmmCoder } = createRequire(import.meta.url)("@meteora-ag/cp-amm-sdk");
import {
  FEE_ESCROW_PROGRAM as PROGRAM,
  allocationAddress,
  configAddress,
  initializeAllocationInstruction,
  collectFeesInstruction,
  ledgerAddress,
  decodeLedger,
  discriminator,
} from "../src";
const DBC = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
const AUTH = new PublicKey("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");
const event = PublicKey.findProgramAddressSync(
  [Buffer.from("__event_authority")],
  DBC,
)[0];
const codec = (
  new DynamicBondingCurveClient(
    new Connection("https://api.devnet.solana.com"),
    "confirmed",
  ).state as any
).program.coder.accounts;
const originalPool = Buffer.from(
  readFileSync(
    fileURLToPath(new URL("./fixtures/dbc-pool.base64", import.meta.url)),
    "utf8",
  ).trim(),
  "base64",
);
const originalConfig = Buffer.from(
  readFileSync(
    fileURLToPath(new URL("./fixtures/dbc-config.base64", import.meta.url)),
    "utf8",
  ).trim(),
  "base64",
);
const key = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});
let svm: LiteSVM,
  payer: Keypair,
  pool: PublicKey,
  dbcConfig: PublicKey,
  base: PublicKey,
  quote: PublicKey,
  baseVault: PublicKey,
  quoteVault: PublicKey,
  allocation: PublicKey,
  state: any;
function set(pubkey: PublicKey, data: Buffer, owner: PublicKey) {
  svm.setAccount({
    address: address(pubkey.toBase58()),
    programAddress: address(owner.toBase58()),
    data,
    lamports: lamports(10_000_000n),
    executable: false,
    space: BigInt(data.length),
  });
}
function data(pubkey: PublicKey) {
  const a = svm.getAccount(address(pubkey.toBase58()));
  if (!a.exists) throw new Error("Missing account");
  return Buffer.from(a.data);
}
function mint(key: PublicKey) {
  const b = Buffer.alloc(MintLayout.span);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 1_000_000_000n,
      decimals: 6,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    b,
  );
  set(key, b, TOKEN_PROGRAM_ID);
}
function readLedger(pubkey: PublicKey) {
  return decodeLedger({
    data: data(pubkey),
    owner: PROGRAM,
    lamports: 10_000_000,
    executable: false,
  });
}
function token(key: PublicKey, mint: PublicKey, amount: bigint) {
  const b = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      mint,
      owner: AUTH,
      amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    b,
  );
  set(key, b, TOKEN_PROGRAM_ID);
}
async function savePool() {
  set(pool, await codec.encode("virtualPool", { poolState: state }), DBC);
}
beforeEach(async () => {
  svm = new LiteSVM().withTransactionHistory(0n);
  svm.addProgramFromFile(
    address(PROGRAM.toBase58()),
    fileURLToPath(
      new URL("../target/deploy/oneonly_fee_escrow.so", import.meta.url),
    ),
  );
  svm.addProgramFromFile(
    address(DBC.toBase58()),
    fileURLToPath(new URL("../target/dbc-devnet.so", import.meta.url)),
  );
  payer = Keypair.generate();
  svm.airdrop(address(payer.publicKey.toBase58()), lamports(3_000_000_000n));
  pool = Keypair.generate().publicKey;
  dbcConfig = Keypair.generate().publicKey;
  base = Keypair.generate().publicKey;
  quote = Keypair.generate().publicKey;
  baseVault = Keypair.generate().publicKey;
  quoteVault = Keypair.generate().publicKey;
  allocation = allocationAddress(pool);
  const bump = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM,
  )[1];
  set(
    configAddress(),
    Buffer.concat([
      discriminator("account", "Config"),
      Keypair.generate().publicKey.toBuffer(),
      Buffer.from([bump]),
    ]),
    PROGRAM,
  );
  const config = Buffer.from(originalConfig);
  quote.toBuffer().copy(config, 8);
  set(dbcConfig, config, DBC);
  state = codec.decode("virtualPool", originalPool).poolState;
  Object.assign(state, {
    config: dbcConfig,
    creator: payer.publicKey,
    baseMint: base,
    baseVault,
    quoteVault,
    poolType: 0,
    isMigrated: 0,
    migrationProgress: 0,
    creatorBaseFee: new BN(1000),
    creatorQuoteFee: new BN(2000),
  });
  await savePool();
  mint(base);
  mint(quote);
  token(baseVault, base, 10_000n);
  token(quoteVault, quote, 20_000n);
});
function init() {
  const transfer = new TransactionInstruction({
    programId: DBC,
    data: Buffer.from([20, 7, 169, 33, 58, 147, 166, 33]),
    keys: [
      key(pool, true),
      key(dbcConfig),
      key(payer.publicKey, false, true),
      key(allocation),
      key(event),
      key(DBC),
      key(PublicKey.default),
    ],
  });
  return initializeAllocationInstruction({
    payer: payer.publicKey,
    pool,
    dbcConfig,
    baseMint: base,
    quoteMint: quote,
    shares: [
      { xId: "1", shareBps: 2500 },
      { xId: "2", shareBps: 7500 },
    ],
    transferInstruction: transfer,
  });
}
function collection() {
  const a = getAssociatedTokenAddressSync(base, allocation, true),
    b = getAssociatedTokenAddressSync(quote, allocation, true);
  const ix = new TransactionInstruction({
    programId: DBC,
    data: Buffer.concat([
      Buffer.from([82, 220, 250, 189, 3, 85, 107, 45]),
      Buffer.alloc(16, 255),
    ]),
    keys: [
      key(AUTH),
      key(pool, true),
      key(a, true),
      key(b, true),
      key(baseVault, true),
      key(quoteVault, true),
      key(base),
      key(quote),
      key(allocation, false, true),
      key(TOKEN_PROGRAM_ID),
      key(TOKEN_PROGRAM_ID),
      key(event),
      key(DBC),
    ],
  });
  return collectFeesInstruction({
    payer: payer.publicKey,
    pool,
    baseMint: base,
    quoteMint: quote,
    baseProgram: TOKEN_PROGRAM_ID,
    quoteProgram: TOKEN_PROGRAM_ID,
    venue: 0,
    meteoraInstruction: ix,
  });
}
const printedCollectionVenues = new Set<number>();
function send(...ix: TransactionInstruction[]) {
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: svm.latestBlockhash(),
  }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
    ...ix,
  );
  tx.sign(payer);
  const wire = tx.serialize();
  expect(wire.length).toBeLessThanOrEqual(1232);
  const last = ix.at(-1)!;
  if (
    last.data.subarray(0, 8).equals(discriminator("global", "collect_fees")) &&
    !printedCollectionVenues.has(last.data[8]!)
  ) {
    console.log(
      "Collection wire bytes (venue, bytes):",
      last.data[8],
      wire.length,
    );
    printedCollectionVenues.add(last.data[8]!);
  }
  return svm.sendTransaction(getTransactionDecoder().decode(wire));
}
function success(result: ReturnType<typeof send>) {
  if (result instanceof FailedTransactionMetadata)
    throw new Error(`${result.err()}\n${result.meta().logs().join("\n")}`);
}
function failed(result: ReturnType<typeof send>, msg: string) {
  expect(result).toBeInstanceOf(FailedTransactionMetadata);
  expect(
    (result as FailedTransactionMetadata).meta().logs().join("\n"),
  ).toContain(msg);
}
it("checks pinned SDK field offsets against the official coder", () => {
  expect(
    new PublicKey(originalPool.subarray(104, 136)).equals(
      codec.decode("virtualPool", originalPool).poolState.creator,
    ),
  ).toBe(true);
  expect(originalPool[308]).toBe(
    codec.decode("virtualPool", originalPool).poolState.migrationProgress,
  );
});
it("transfers creator authority atomically through the real devnet Meteora program", () => {
  success(send(init()));
  expect(
    codec
      .decode("virtualPool", data(pool))
      .poolState.creator.equals(allocation),
  ).toBe(true);
});
it("rejects wrong creator and graduated pools before locking an allocation", async () => {
  state.creator = Keypair.generate().publicKey;
  await savePool();
  failed(send(init()), "InvalidPool");
  expect(svm.getAccount(address(allocation.toBase58())).exists).toBe(false);
  state.creator = payer.publicKey;
  state.isMigrated = 1;
  state.migrationProgress = 3;
  await savePool();
  failed(send(init()), "InvalidPool");
});
it("collects real DBC fees into separate ledgers once with no duplicate accrual", () => {
  success(send(init()));
  success(send(collection()));
  const a = ledgerAddress(allocation, base),
    b = ledgerAddress(allocation, quote);
  expect(readLedger(a).totalReceived).toBe(1000n);
  expect(readLedger(b).totalReceived).toBe(2000n);
  success(send(collection()));
  expect(readLedger(a).totalReceived).toBe(1000n);
  expect(readLedger(b).totalReceived).toBe(2000n);
});
it("rejects redirected collection and substituted pool", () => {
  success(send(init()));
  const bad = collection();
  bad.keys[12 + 2].pubkey = baseVault;
  failed(send(bad), "InvalidCollection");
  const other = collection();
  other.keys[12 + 1].pubkey = dbcConfig;
  failed(send(other), "InvalidCollection");
});

const DAMM = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
const DAMM_AUTH = new PublicKey("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");
function dammFixture(name: string) {
  return Buffer.from(
    readFileSync(
      fileURLToPath(new URL(`./fixtures/damm-${name}.base64`, import.meta.url)),
      "utf8",
    ).trim(),
    "base64",
  );
}
function encodeDamm(name: string, state: any) {
  const entry = cpAmmCoder.accounts.accountLayouts.get(name);
  const bytes = Buffer.alloc(4096);
  const len = entry.layout.encode(state, bytes);
  return Buffer.concat([
    Buffer.from(entry.discriminator),
    bytes.subarray(0, len),
  ]);
}
function setupDamm() {
  success(send(init()));
  svm.addProgramFromFile(
    address(DAMM.toBase58()),
    fileURLToPath(new URL("../target/damm-devnet.so", import.meta.url)),
  );
  const ammPool = Keypair.generate().publicKey,
    position = Keypair.generate().publicKey,
    nft = Keypair.generate().publicKey;
  const ps = cpAmmCoder.accounts.decode("Pool", dammFixture("pool"));
  Object.assign(ps, {
    token_a_mint: base,
    token_b_mint: quote,
    token_a_vault: baseVault,
    token_b_vault: quoteVault,
  });
  set(ammPool, encodeDamm("Pool", ps), DAMM);
  const pos = cpAmmCoder.accounts.decode("Position", dammFixture("position"));
  Object.assign(pos, {
    pool: ammPool,
    fee_a_pending: new BN(1000),
    fee_b_pending: new BN(2000),
  });
  set(position, encodeDamm("Position", pos), DAMM);
  const nftData = dammFixture("nft");
  allocation.toBuffer().copy(nftData, 32);
  set(
    nft,
    nftData,
    new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
  );
  for (const v of [baseVault, quoteVault]) {
    const bytes = data(v);
    DAMM_AUTH.toBuffer().copy(bytes, 32);
    set(v, bytes, TOKEN_PROGRAM_ID);
  }
  const ix = new TransactionInstruction({
    programId: DAMM,
    data: Buffer.from([180, 38, 154, 17, 133, 33, 162, 211]),
    keys: [
      key(DAMM_AUTH),
      key(ammPool),
      key(position, true),
      key(getAssociatedTokenAddressSync(base, allocation, true), true),
      key(getAssociatedTokenAddressSync(quote, allocation, true), true),
      key(baseVault, true),
      key(quoteVault, true),
      key(base),
      key(quote),
      key(nft),
      key(allocation, false, true),
      key(TOKEN_PROGRAM_ID),
      key(TOKEN_PROGRAM_ID),
      key(
        PublicKey.findProgramAddressSync(
          [Buffer.from("__event_authority")],
          DAMM,
        )[0],
      ),
      key(DAMM),
    ],
  });
  const collection = collectFeesInstruction({
    payer: payer.publicKey,
    pool,
    baseMint: base,
    quoteMint: quote,
    baseProgram: TOKEN_PROGRAM_ID,
    quoteProgram: TOKEN_PROGRAM_ID,
    venue: 1,
    meteoraInstruction: ix,
  });
  return { collection, position, nft, pos };
}
it("collects real DAMM position fees without withdrawing locked principal", () => {
  const d = setupDamm();
  success(send(d.collection));
  expect(readLedger(ledgerAddress(allocation, base)).totalReceived).toBe(1000n);
  expect(readLedger(ledgerAddress(allocation, quote)).totalReceived).toBe(
    2000n,
  );
  expect(AccountLayout.decode(data(baseVault)).amount).toBe(9000n);
  expect(AccountLayout.decode(data(quoteVault)).amount).toBe(18000n);
  const after = cpAmmCoder.accounts.decode("Position", data(d.position));
  for (const name of [
    "unlocked_liquidity",
    "vested_liquidity",
    "permanent_locked_liquidity",
  ])
    expect(after[name].eq(d.pos[name])).toBe(true);
  success(send(d.collection));
  expect(readLedger(ledgerAddress(allocation, base)).totalReceived).toBe(1000n);
  expect(readLedger(ledgerAddress(allocation, quote)).totalReceived).toBe(
    2000n,
  );
});
it("rejects DAMM position fees without actual allocation NFT ownership", () => {
  const d = setupDamm();
  const b = data(d.nft);
  payer.publicKey.toBuffer().copy(b, 32);
  set(d.nft, b, new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"));
  failed(send(d.collection), "InvalidCollection");
});
