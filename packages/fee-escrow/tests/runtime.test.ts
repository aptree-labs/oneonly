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
  initializeControlInstruction,
  setPausedInstruction,
  rotateVerifierInstruction,
  decodeControl,
  configAddress,
  controlAddress,
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
  const [control, controlBump] = pda(Buffer.from("control"));
  set(
    control,
    Buffer.concat([
      discriminator("account", "Control"),
      Buffer.from([controlBump, 0]),
      u64(1n),
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
    epoch: bigint;
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
    epoch = overrides.epoch ?? 1n,
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
    u64(epoch),
  ]);
  const message = Buffer.concat([
    Buffer.from("oneonly:fee:v2:devnet"),
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
    u64(epoch),
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
      key(controlAddress()),
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
    verifierEpoch: 1n,
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

const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
function updateUpgradeAuthority(authority: PublicKey | null) {
  const pd = new PublicKey(get(PROGRAM).subarray(4, 36));
  const info = svm.getAccount(address(pd.toBase58()));
  if (!info.exists) throw new Error("Missing program data");
  const data = Buffer.from(info.data);
  data[12] = authority ? 1 : 0;
  (authority?.toBuffer() ?? Buffer.alloc(32)).copy(data, 13);
  svm.setAccount({ ...info, data });
}
function enableAdministration(authority = wallet.publicKey) {
  svm.addProgramWithLoader(
    address(PROGRAM.toBase58()),
    readFileSync(so),
    address(loader.toBase58()),
  );
  updateUpgradeAuthority(authority);
}
function administer(instruction: TransactionInstruction, signer = wallet) {
  const tx = new Transaction({
    feePayer: signer.publicKey,
    recentBlockhash: svm.latestBlockhash(),
  }).add(instruction);
  tx.sign(signer);
  return svm.sendTransaction(getTransactionDecoder().decode(tx.serialize()));
}
function readControl() {
  return decodeControl({
    data: get(controlAddress()),
    owner: PROGRAM,
    lamports: 1,
    executable: false,
  });
}
it.each([true, false])(
  "initializes control only with the current upgrade authority (%s)",
  (authorized) => {
    enableAdministration(
      authorized ? wallet.publicKey : Keypair.generate().publicKey,
    );
    // Simulate an upgrade from v1: old config exists, control PDA does not yet exist.
    set(controlAddress(), Buffer.alloc(0), SystemProgram.programId);
    const result = administer(initializeControlInstruction(wallet.publicKey));
    if (authorized) {
      success(result);
      expect(readControl()).toMatchObject({ paused: false, verifierEpoch: 1n });
      failed(administer(initializeControlInstruction(wallet.publicKey)));
    } else {
      failed(result, "InvalidAuthority");
      expect(get(controlAddress())).toHaveLength(0);
    }
  },
);
it("pauses claims without consuming their nonce, then allows the same proof after unpause", () => {
  enableAdministration();
  const pending = build();
  success(administer(setPausedInstruction(wallet.publicKey, true)));
  expect(readControl().paused).toBe(true);
  failed(send(pending), "Paused");
  expect(AccountLayout.decode(get(vault)).amount).toBe(1000n);
  expect(svm.getAccount(address(pending.receipt.toBase58())).exists).toBe(
    false,
  );
  success(administer(setPausedInstruction(wallet.publicKey, false)));
  success(send(pending));
  expect(AccountLayout.decode(get(pending.destination)).amount).toBe(250n);
});
it("fails closed when the required control account is missing or substituted", () => {
  const missing = build();
  set(controlAddress(), Buffer.alloc(0), SystemProgram.programId);
  failed(send(missing));
  expect(AccountLayout.decode(get(vault)).amount).toBe(1000n);
  setup();
  const other = Keypair.generate().publicKey;
  set(other, get(controlAddress()));
  const substituted = build();
  substituted.claim.keys[substituted.claim.keys.length - 1].pubkey = other;
  failed(send(substituted), "ConstraintSeeds");
  expect(svm.getAccount(address(substituted.receipt.toBase58())).exists).toBe(
    false,
  );
});
it("uses current upgrade authority for pause and rotation, rejecting former, unsigned and revoked authority", () => {
  enableAdministration();
  const replacement = Keypair.generate();
  svm.airdrop(
    address(replacement.publicKey.toBase58()),
    lamports(1_000_000_000n),
  );
  updateUpgradeAuthority(replacement.publicKey);
  failed(
    administer(setPausedInstruction(wallet.publicKey, true)),
    "InvalidAuthority",
  );
  failed(
    administer(
      rotateVerifierInstruction(wallet.publicKey, Keypair.generate().publicKey),
    ),
    "InvalidAuthority",
  );
  expect(readControl()).toMatchObject({ paused: false, verifierEpoch: 1n });
  const unsigned = setPausedInstruction(replacement.publicKey, true);
  unsigned.keys[0].isSigner = false;
  failed(administer(unsigned), "AccountNotSigner");
  success(
    administer(setPausedInstruction(replacement.publicKey, true), replacement),
  );
  expect(readControl().paused).toBe(true);
  updateUpgradeAuthority(null);
  failed(
    administer(setPausedInstruction(replacement.publicKey, false), replacement),
    "InvalidAuthority",
  );
  expect(readControl().paused).toBe(true);
});
it("rejects fake ProgramData or program accounts for emergency controls", () => {
  enableAdministration();
  const pd = new PublicKey(get(PROGRAM).subarray(4, 36));
  const fake = Keypair.generate().publicKey;
  set(fake, get(pd), loader);
  const wrongData = setPausedInstruction(wallet.publicKey, true);
  wrongData.keys[4].pubkey = fake;
  failed(administer(wrongData), "InvalidAuthority");
  const wrongProgram = setPausedInstruction(wallet.publicKey, true);
  wrongProgram.keys[3].pubkey = SystemProgram.programId;
  failed(administer(wrongProgram), "InvalidProgramId");
  expect(readControl().paused).toBe(false);
});
it("rotation revokes pending signatures, including future-issued proofs after A to B to A", () => {
  enableAdministration();
  const a = verifier;
  const b = Keypair.generate();
  const old = build();
  const future = build({ issued: 1100n, expires: 1300n });
  success(administer(rotateVerifierInstruction(wallet.publicKey, b.publicKey)));
  expect(readControl().verifierEpoch).toBe(2n);
  failed(send(old), "InvalidVerifierEpoch");
  const middle = build({ signer: b, epoch: 2n, limit: 100n });
  success(send(middle));
  expect(AccountLayout.decode(get(middle.destination)).amount).toBe(100n);
  success(administer(rotateVerifierInstruction(wallet.publicKey, a.publicKey)));
  expect(readControl().verifierEpoch).toBe(3n);
  const clock = svm.getClock();
  clock.unixTimestamp = 1100n;
  svm.setClock(clock);
  failed(send(future), "InvalidVerifierEpoch");
  failed(send(old), "InvalidVerifierEpoch");
  expect(svm.getAccount(address(future.receipt.toBase58())).exists).toBe(false);
  expect(svm.getAccount(address(old.receipt.toBase58())).exists).toBe(false);
  const fresh = build({ signer: a, epoch: 3n, issued: 1100n });
  success(send(fresh));
  expect(AccountLayout.decode(get(fresh.destination)).amount).toBe(250n);
});
it("validates verifier points on chain and keeps rotation atomic on invalid keys or epoch overflow", () => {
  enableAdministration();
  const original = Buffer.from(get(config));
  const offCurve = PublicKey.findProgramAddressSync(
    [Buffer.from("invalid-verifier")],
    PROGRAM,
  )[0];
  for (const invalid of [PublicKey.default, offCurve]) {
    const ix = rotateVerifierInstruction(
      wallet.publicKey,
      Keypair.generate().publicKey,
    );
    ix.data = Buffer.concat([
      discriminator("global", "rotate_verifier"),
      invalid.toBuffer(),
    ]);
    failed(administer(ix), "InvalidVerifier");
    expect(get(config)).toEqual(original);
    expect(readControl().verifierEpoch).toBe(1n);
  }
  const control = get(controlAddress());
  control.writeBigUInt64LE((1n << 64n) - 1n, 10);
  set(controlAddress(), control);
  failed(
    administer(
      rotateVerifierInstruction(wallet.publicKey, Keypair.generate().publicKey),
    ),
    "Overflow",
  );
  expect(get(config)).toEqual(original);
});
