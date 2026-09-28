import { beforeEach, describe, expect, it } from "vitest";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AccountLayout,
  MintLayout,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Ed25519Program,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { address, lamports, getTransactionDecoder } from "@solana/kit";
import type { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { prepareTransactionWire } from "../../protocol/src/wire";
import {
  MAINNET_FEE_ESCROW_PROGRAM as PROGRAM,
  claimMessage,
  claimInstructions,
  allocationAddress,
  configAddress,
  controlAddress,
  ledgerAddress,
  discriminator,
} from "../src";

// Local VM only: actual reviewed mainnet ELF, fixture-injected allocation/ledger.
// Does not initialize accounts or move funds on any network, or exercise Meteora.
const suite = describe.skipIf(
  process.env.CREATOR_FEE_MAINNET_RUNTIME_TESTS !== "true",
);
const artifact = fileURLToPath(
  new URL(
    "../../../.local/fee-escrow/mainnet-release-src/build/oneonly_fee_escrow.so",
    import.meta.url,
  ),
);
const expectedArtifactHash =
  "43e17fdd453b47d823a7a2291d22a397ca0860ee7fca75159c8e6ac39c9839fd";
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const bps = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
let svm: LiteSVM,
  failureType: typeof FailedTransactionMetadata,
  wallet: Keypair,
  verifier: Keypair,
  pool: PublicKey,
  mint: PublicKey,
  allocation: PublicKey,
  vault: PublicKey;
const xid = Buffer.alloc(32, 1);
function put(pubkey: PublicKey, data: Buffer, owner = PROGRAM) {
  svm.setAccount({
    address: address(pubkey.toBase58()),
    programAddress: address(owner.toBase58()),
    data,
    lamports: lamports(10_000_000n),
    executable: false,
    space: BigInt(data.length),
  });
}
function amount(pubkey: PublicKey) {
  const account = svm.getAccount(address(pubkey.toBase58()));
  return account.exists ? AccountLayout.decode(account.data).amount : 0n;
}
function pda(...seeds: Uint8Array[]) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM);
}
function transaction(devnetAttestation = false, bothBudgets = false) {
  const destination = getAssociatedTokenAddressSync(mint, wallet.publicKey);
  const claim = {
    xIdHash: xid,
    cumulativeLimit: 250n,
    bindingVersion: 1n,
    verifierEpoch: 1n,
    nonce: Buffer.alloc(32, 6),
    issuedAt: 1000n,
    expiresAt: 1100n,
  };
  const mainnetMessage = claimMessage(
    claim,
    allocation,
    mint,
    wallet.publicKey,
    destination,
    PROGRAM,
    "mainnet-beta",
  );
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(verifier.secretKey.subarray(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const instructions = claimInstructions({
    claim,
    pool,
    mint,
    wallet: wallet.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    verifier: verifier.publicKey,
    signature: sign(null, mainnetMessage, privateKey),
    program: PROGRAM,
    network: "mainnet-beta",
  });
  if (devnetAttestation) {
    // Deliberately bypass SDK rejection to prove the compiled mainnet contract rejects a
    // cryptographically valid devnet-domain attestation with otherwise identical fields.
    const wrongMessage = Buffer.concat([
      Buffer.from("oneonly:fee:v2:devnet"),
      mainnetMessage.subarray(Buffer.byteLength("oneonly:fee:v2:mainnet-beta")),
    ]);
    instructions[0] = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: verifier.secretKey,
      message: wrongMessage,
    });
  }
  const tx = new Transaction({
    feePayer: wallet.publicKey,
    recentBlockhash: svm.latestBlockhash(),
  }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
  if (bothBudgets)
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }));
  tx.add(...instructions);
  tx.sign(wallet);
  return { tx, destination };
}
suite("reviewed mainnet ELF claim domain", () => {
  beforeEach(async () => {
    const native = await import("litesvm");
    failureType = native.FailedTransactionMetadata;
    const elf = readFileSync(artifact);
    expect(createHash("sha256").update(elf).digest("hex")).toBe(
      expectedArtifactHash,
    );
    svm = new native.LiteSVM().withTransactionHistory(0n);
    svm.addProgramFromFile(address(PROGRAM.toBase58()), artifact);
    const clock = svm.getClock();
    clock.unixTimestamp = 1000n;
    svm.setClock(clock);
    wallet = Keypair.generate();
    verifier = Keypair.generate();
    pool = Keypair.generate().publicKey;
    mint = Keypair.generate().publicKey;
    svm.airdrop(address(wallet.publicKey.toBase58()), lamports(3_000_000_000n));
    put(
      configAddress(PROGRAM),
      Buffer.concat([
        discriminator("account", "Config"),
        verifier.publicKey.toBuffer(),
        Buffer.from([pda(Buffer.from("config"))[1]]),
      ]),
    );
    put(
      controlAddress(PROGRAM),
      Buffer.concat([
        discriminator("account", "Control"),
        Buffer.from([pda(Buffer.from("control"))[1], 0]),
        u64(1n),
      ]),
    );
    allocation = allocationAddress(pool, PROGRAM);
    put(
      allocation,
      Buffer.concat([
        discriminator("account", "Allocation"),
        pool.toBuffer(),
        mint.toBuffer(),
        Keypair.generate().publicKey.toBuffer(),
        wallet.publicKey.toBuffer(),
        Buffer.from([pda(Buffer.from("allocation"), pool.toBuffer())[1]]),
        u32(2),
        xid,
        bps(2500),
        Buffer.alloc(32, 2),
        bps(7500),
      ]),
    );
    put(
      ledgerAddress(allocation, mint, PROGRAM),
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
        supply: 1000n,
        decimals: 6,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      mintData,
    );
    put(mint, mintData, TOKEN_PROGRAM_ID);
    vault = getAssociatedTokenAddressSync(mint, allocation, true);
    const tokenData = Buffer.alloc(AccountLayout.span);
    AccountLayout.encode(
      {
        mint,
        owner: allocation,
        amount: 1000n,
        delegateOption: 0,
        delegate: PublicKey.default,
        state: 1,
        isNativeOption: 0,
        isNative: 0n,
        delegatedAmount: 0n,
        closeAuthorityOption: 0,
        closeAuthority: PublicKey.default,
      },
      tokenData,
    );
    put(vault, tokenData, TOKEN_PROGRAM_ID);
  });
  it("accepts the actual SDK mainnet attestation and pays the exact share within a single packet", () => {
    const { tx, destination } = transaction();
    const wire = tx.serialize();
    expect(wire.length).toBeLessThanOrEqual(1232);
    const result = svm.sendTransaction(getTransactionDecoder().decode(wire));
    if (result instanceof failureType)
      throw new Error(`${result.err()}\n${result.meta().logs().join("\n")}`);
    expect(amount(destination)).toBe(250n);
    expect(amount(vault)).toBe(750n);
  });
  it("rejects a valid Ed25519 signature over a devnet domain without moving tokens", () => {
    const { tx, destination } = transaction(true);
    const result = svm.sendTransaction(
      getTransactionDecoder().decode(tx.serialize()),
    );
    expect(result).toBeInstanceOf(failureType);
    expect(
      (result as FailedTransactionMetadata).meta().logs().join("\n"),
    ).toContain("InvalidAttestation");
    expect(amount(destination)).toBe(0n);
    expect(amount(vault)).toBe(1000n);
  });
  it("exposes the six-byte mainnet packet increase so the caller must omit redundant price budget", () => {
    const { tx } = transaction(false, true);
    const size =
      1 +
      64 * tx.compileMessage().header.numRequiredSignatures +
      tx.serializeMessage().length;
    expect(size).toBe(1235);
    expect(transaction().tx.serialize().length).toBe(1223);
  });
  it("executes the production packing helper output with the full compute limit preserved", () => {
    const initial = transaction();
    const bare = new Transaction().add(
      ...initial.tx.instructions.filter(
        (ix) => !ix.programId.equals(ComputeBudgetProgram.programId),
      ),
    );
    const encoded = prepareTransactionWire(
      bare,
      wallet.publicKey.toBase58(),
      svm.latestBlockhash(),
      [],
      { omitAddedPriorityFeeIfOversize: true },
    );
    expect(Buffer.from(encoded.wire, "base64").length).toBe(1223);
    const packed = Transaction.from(Buffer.from(encoded.wire, "base64"));
    const budgets = packed.instructions.filter((ix) =>
      ix.programId.equals(ComputeBudgetProgram.programId),
    );
    expect(budgets).toHaveLength(1);
    expect(budgets[0].data[0]).toBe(2);
    expect(budgets[0].data.readUInt32LE(1)).toBe(1_400_000);
    expect(
      packed.instructions.find((ix) =>
        ix.programId.equals(Ed25519Program.programId),
      )?.data,
    ).toEqual(
      bare.instructions.find((ix) =>
        ix.programId.equals(Ed25519Program.programId),
      )?.data,
    );
    packed.sign(wallet);
    const result = svm.sendTransaction(
      getTransactionDecoder().decode(packed.serialize()),
    );
    if (result instanceof failureType)
      throw new Error(`${result.err()}\n${result.meta().logs().join("\n")}`);
    expect(amount(initial.destination)).toBe(250n);
    expect(amount(vault)).toBe(750n);
  });
});
