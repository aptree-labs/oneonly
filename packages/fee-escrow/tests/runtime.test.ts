import { beforeEach, expect, it } from "vitest";
import { createHash, randomBytes, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AccountLayout,
  MintLayout,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Ed25519Program,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { getTransactionDecoder, address, lamports } from "@solana/kit";
import { LiteSVM, FailedTransactionMetadata } from "litesvm";

import {
  claimMessage,
  claimInstructions,
  initializeConfigInstruction,
  configAddress,
  decodeConfig,
} from "../src";

// These tests execute the compiled escrow and real token programs. Allocation,
// mint and collected-ledger accounts are fixture-injected; they do NOT claim
// to exercise Meteora creation, collection, or graduation.
const PROGRAM = new PublicKey("BJk7HqbLecWFBFxFTULnmpSwmViLg9FeRLBajewvJ3g4");
const so = fileURLToPath(
  new URL("../target/deploy/oneonly_fee_escrow.so", import.meta.url),
);
const discriminator = (kind: string, name: string) =>
  createHash("sha256").update(`${kind}:${name}`).digest().subarray(0, 8);
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const i64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const pda = (...seeds: Uint8Array[]) =>
  PublicKey.findProgramAddressSync(seeds, PROGRAM);
const key = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});
const bps = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
let svm: LiteSVM,
  wallet: Keypair,
  verifier: Keypair,
  pool: PublicKey,
  mint: PublicKey,
  allocation: PublicKey,
  ledger: PublicKey,
  config: PublicKey,
  vault: PublicKey,
  tokenProgram: PublicKey;
const xid = Buffer.alloc(32, 1);
function set(pubkey: PublicKey, data: Buffer, owner = PROGRAM) {
  svm.setAccount({
    address: address(pubkey.toBase58()),
    programAddress: address(owner.toBase58()),
    data,
    lamports: lamports(10_000_000n),
    executable: false,
    space: BigInt(data.length),
  });
}
function get(pubkey: PublicKey) {
  const a = svm.getAccount(address(pubkey.toBase58()));
  if (!a.exists) throw new Error("Missing account");
  return Buffer.from(a.data);
}
function token(pubkey: PublicKey, owner: PublicKey, amount: bigint) {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      mint,
      owner,
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
    data,
  );
  set(pubkey, data, tokenProgram);
}
function setup(program = TOKEN_PROGRAM_ID) {
  tokenProgram = program;
  svm = new LiteSVM().withTransactionHistory(0n);
  svm.addProgramFromFile(address(PROGRAM.toBase58()), so);
  const clock = svm.getClock();
  clock.unixTimestamp = 1000n;
  svm.setClock(clock);
  wallet = Keypair.generate();
  verifier = Keypair.generate();
  pool = Keypair.generate().publicKey;
  mint = Keypair.generate().publicKey;
  svm.airdrop(address(wallet.publicKey.toBase58()), lamports(3_000_000_000n));
  let bump;
  [config, bump] = pda(Buffer.from("config"));
  set(
    config,
    Buffer.concat([
      discriminator("account", "Config"),
      verifier.publicKey.toBuffer(),
      Buffer.from([bump]),
    ]),
  );
  [allocation, bump] = pda(Buffer.from("allocation"), pool.toBuffer());
  set(
    allocation,
    Buffer.concat([
      discriminator("account", "Allocation"),
      pool.toBuffer(),
      mint.toBuffer(),
      Keypair.generate().publicKey.toBuffer(),
      wallet.publicKey.toBuffer(),
      Buffer.from([bump]),
      u32(2),
      xid,
      bps(2500),
      Buffer.alloc(32, 2),
      bps(7500),
    ]),
  );
  [ledger] = pda(Buffer.from("ledger"), allocation.toBuffer(), mint.toBuffer());
  set(
    ledger,
    Buffer.concat([
      discriminator("account", "Ledger"),
      allocation.toBuffer(),
      mint.toBuffer(),
      u64(1000n),
    ]),
  );
  const mintData = Buffer.alloc(MintLayout.span);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 1_000_000n,
      decimals: 6,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    mintData,
  );
  set(mint, mintData, tokenProgram);
  vault = getAssociatedTokenAddressSync(mint, allocation, true, tokenProgram);
  token(vault, allocation, 1000n);
}
beforeEach(() => setup());
function build(
  overrides: Partial<{
    claimant: Keypair;
    hash: Buffer;
    limit: bigint;
    version: bigint;
    nonce: Buffer;
    issued: bigint;
    expires: bigint;
    signer: Keypair;
    destination: PublicKey;
    messageProgram: PublicKey;
    messageAllocation: PublicKey;
    messageMint: PublicKey;
  }> = {},
) {
  const claimant = overrides.claimant ?? wallet,
    hash = overrides.hash ?? xid,
    limit = overrides.limit ?? 250n,
    version = overrides.version ?? 1n,
    nonce = overrides.nonce ?? randomBytes(32),
    issued = overrides.issued ?? 1000n,
    expires = overrides.expires ?? 1300n;
  const destination =
    overrides.destination ??
    getAssociatedTokenAddressSync(
      mint,
      claimant.publicKey,
      false,
      tokenProgram,
    );
  const args = Buffer.concat([
    hash,
    u64(limit),
    u64(version),
    nonce,
    i64(issued),
    i64(expires),
  ]);
  const message = Buffer.concat([
    Buffer.from("oneonly:fee-claim:v1:devnet"),
    (overrides.messageProgram ?? PROGRAM).toBuffer(),
    (overrides.messageAllocation ?? allocation).toBuffer(),
    (overrides.messageMint ?? mint).toBuffer(),
    hash,
    claimant.publicKey.toBuffer(),
    destination.toBuffer(),
    u64(limit),
    u64(version),
    nonce,
    i64(issued),
    i64(expires),
  ]);
  const [beneficiary] = pda(Buffer.from("beneficiary"), hash),
    [claimed] = pda(Buffer.from("claim"), ledger.toBuffer(), hash),
    [receipt] = pda(Buffer.from("receipt"), nonce);
  const verify = Ed25519Program.createInstructionWithPrivateKey({
    privateKey: (overrides.signer ?? verifier).secretKey,
    message,
  });
  const claim = new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      key(claimant.publicKey, true, true),
      key(config),
      key(allocation),
      key(ledger),
      key(mint),
      key(vault, true),
      key(destination, true),
      key(beneficiary, true),
      key(claimed, true),
      key(receipt, true),
      key(SYSVAR_INSTRUCTIONS_PUBKEY),
      key(tokenProgram),
      key(ASSOCIATED_TOKEN_PROGRAM_ID),
      key(SystemProgram.programId),
    ],
    data: Buffer.concat([discriminator("global", "claim"), args]),
  });
  return {
    claimant,
    destination,
    beneficiary,
    claimed,
    receipt,
    verify,
    claim,
    nonce,
  };
}
let printedClaimWire = false;
function send(b: ReturnType<typeof build>, verify = true) {
  const tx = new Transaction({
    feePayer: b.claimant.publicKey,
    recentBlockhash: svm.latestBlockhash(),
  });
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
  );
  if (verify) tx.add(b.verify);
  tx.add(b.claim);
  tx.sign(b.claimant);
  const wire = tx.serialize();
  expect(wire.length).toBeLessThanOrEqual(1232);
  if (!printedClaimWire) {
    console.log("Claim wire bytes with both compute budgets:", wire.length);
    printedClaimWire = true;
  }
  return svm.sendTransaction(getTransactionDecoder().decode(wire));
}
function success(result: ReturnType<typeof send>) {
  if (result instanceof FailedTransactionMetadata)
    throw new Error(`${result.err()}\n${result.meta().logs().join("\n")}`);
}
function failed(result: ReturnType<typeof send>, error?: string) {
  expect(result).toBeInstanceOf(FailedTransactionMetadata);
  if (error)
    expect(
      (result as FailedTransactionMetadata).meta().logs().join("\n"),
    ).toContain(error);
}
it("pays exact fixed share, freezes the wallet binding and consumes nonce", () => {
  const b = build();
  success(send(b));
  expect(AccountLayout.decode(get(b.destination)).amount).toBe(250n);
  expect(AccountLayout.decode(get(vault)).amount).toBe(750n);
  expect(get(b.claimed).readBigUInt64LE(8)).toBe(250n);
  expect(
    new PublicKey(get(b.beneficiary).subarray(40, 72)).equals(wallet.publicKey),
  ).toBe(true);
  expect(get(b.receipt).readBigUInt64LE(136)).toBe(250n);
  failed(send(b));
  expect(AccountLayout.decode(get(vault)).amount).toBe(750n);
});
it("caps an oversized signed authorization at actual entitlement", () => {
  const b = build({ limit: (1n << 64n) - 1n });
  success(send(b));
  expect(AccountLayout.decode(get(b.destination)).amount).toBe(250n);
});
it("pays cumulative differences only after more deposits", () => {
  const first = build({ limit: 100n });
  success(send(first));
  const second = build();
  success(send(second));
  expect(AccountLayout.decode(get(second.destination)).amount).toBe(250n);
  failed(send(build()), "NothingToClaim");
  set(
    ledger,
    Buffer.concat([
      discriminator("account", "Ledger"),
      allocation.toBuffer(),
      mint.toBuffer(),
      u64(2000n),
    ]),
  );
  token(vault, allocation, 1750n);
  const third = build({ limit: 500n });
  success(send(third));
  expect(AccountLayout.decode(get(third.destination)).amount).toBe(500n);
});
it.each([
  [
    "wrong verifier",
    () => ({ signer: Keypair.generate() }),
    "InvalidAttestation",
  ],
  [
    "wrong program domain",
    () => ({ messageProgram: Keypair.generate().publicKey }),
    "InvalidAttestation",
  ],
  [
    "wrong pool scope",
    () => ({ messageAllocation: Keypair.generate().publicKey }),
    "InvalidAttestation",
  ],
  [
    "wrong mint scope",
    () => ({ messageMint: Keypair.generate().publicKey }),
    "InvalidAttestation",
  ],
  [
    "unknown X identity",
    () => ({ hash: Buffer.alloc(32, 3) }),
    "UnknownRecipient",
  ],
  ["expired", () => ({ issued: 500n, expires: 999n }), "Expired"],
  ["future issuance", () => ({ issued: 1001n }), "Expired"],
  ["excess lifetime", () => ({ expires: 1901n }), "Expired"],
  ["wrong binding version", () => ({ version: 2n }), "InvalidBinding"],
] as const)(
  "rejects %s without changing balances",
  (_name, overrides, error) => {
    const b = build(overrides());
    failed(send(b), error);
    expect(AccountLayout.decode(get(vault)).amount).toBe(1000n);
    expect(svm.getAccount(address(b.receipt.toBase58())).exists).toBe(false);
  },
);
it("rejects a second wallet even when the verifier signs a new proof", () => {
  success(send(build({ limit: 100n })));
  const other = Keypair.generate();
  svm.airdrop(address(other.publicKey.toBase58()), lamports(1_000_000_000n));
  failed(send(build({ claimant: other })), "InvalidBinding");
});
it("requires the ed25519 precompile and validates its cryptographic signature", () => {
  failed(send(build(), false), "InvalidAttestation");
  const b = build();
  b.verify.data[48] ^= 1;
  failed(send(b));
  expect(AccountLayout.decode(get(vault)).amount).toBe(1000n);
});
it("rejects an altered destination rather than redirecting the payout", () => {
  const other = Keypair.generate().publicKey;
  const destination = getAssociatedTokenAddressSync(
    mint,
    other,
    false,
    tokenProgram,
  );
  token(destination, other, 0n);
  failed(send(build({ destination })));
  expect(AccountLayout.decode(get(destination)).amount).toBe(0n);
});
it("supports Token2022 base units through the actual Token2022 transfer program", () => {
  setup(TOKEN_2022_PROGRAM_ID);
  const b = build();
  success(send(b));
  expect(AccountLayout.decode(get(b.destination)).amount).toBe(250n);
});

it("executes the public TS client encoding against the compiled program within one packet", () => {
  const b = build();
  const args = {
    xIdHash: xid,
    cumulativeLimit: 250n,
    bindingVersion: 1n,
    nonce: b.nonce,
    issuedAt: 1000n,
    expiresAt: 1100n,
  };
  const message = claimMessage(
    args,
    allocation,
    mint,
    wallet.publicKey,
    b.destination,
  );
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(verifier.secretKey.subarray(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const [verify, claim] = claimInstructions({
    claim: args,
    pool,
    mint,
    wallet: wallet.publicKey,
    tokenProgram,
    verifier: verifier.publicKey,
    signature: sign(null, message, privateKey),
  });
  success(send({ ...b, verify, claim }));
  expect(AccountLayout.decode(get(b.destination)).amount).toBe(250n);
});

it.each([true, false])(
  "initializes config only with the actual program upgrade authority (%s)",
  (authorized) => {
    svm = new LiteSVM().withTransactionHistory(0n);
    const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
    svm.addProgramWithLoader(
      address(PROGRAM.toBase58()),
      readFileSync(so),
      address(loader.toBase58()),
    );
    svm.airdrop(address(wallet.publicKey.toBase58()), lamports(3_000_000_000n));
    const programInfo = svm.getAccount(address(PROGRAM.toBase58()));
    if (!programInfo.exists) throw new Error("Program missing");
    const pd = new PublicKey(Buffer.from(programInfo.data).subarray(4, 36));
    const pdInfo = svm.getAccount(address(pd.toBase58()));
    if (!pdInfo.exists) throw new Error("Program data missing");
    const bytes = Buffer.from(pdInfo.data);
    bytes[12] = 1;
    (authorized ? wallet.publicKey : Keypair.generate().publicKey)
      .toBuffer()
      .copy(bytes, 13);
    svm.setAccount({ ...pdInfo, data: bytes });
    const tx = new Transaction({
      feePayer: wallet.publicKey,
      recentBlockhash: svm.latestBlockhash(),
    }).add(initializeConfigInstruction(wallet.publicKey, verifier.publicKey));
    tx.sign(wallet);
    const result = svm.sendTransaction(
      getTransactionDecoder().decode(tx.serialize()),
    );
    if (authorized) {
      success(result);
      expect(
        decodeConfig({
          data: get(configAddress()),
          owner: PROGRAM,
          lamports: 1,
          executable: false,
        }).verifier.equals(verifier.publicKey),
      ).toBe(true);
    } else {
      failed(result, "InvalidAuthority");
      expect(svm.getAccount(address(configAddress().toBase58())).exists).toBe(
        false,
      );
    }
  },
);
