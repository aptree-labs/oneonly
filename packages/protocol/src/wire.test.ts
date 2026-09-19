import { expect, it } from "vitest";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  Transaction,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  AddressLookupTableAccount,
  Message,
} from "@solana/web3.js";
import {
  decodeWalletTransaction,
  transactionMessage,
  verifyWalletTransaction,
  prepareTransactionWire,
  isLegacyTransaction,
  validateWalletFeeChange,
} from "./wire";
it("prepares an external SDK legacy launch without relying on constructor identity", () => {
  const payer = Keypair.generate(),
    mint = Keypair.generate();
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: 1,
      space: 82,
      programId: SystemProgram.programId,
    }),
  );
  // Reproduce an externalized web3 class: identical API, distinct prototype.
  Object.setPrototypeOf(
    tx,
    Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(Transaction.prototype),
    ),
  );
  expect(tx instanceof Transaction).toBe(false);
  expect(isLegacyTransaction(tx)).toBe(true);
  const result = prepareTransactionWire(
    tx,
    payer.publicKey.toBase58(),
    Keypair.generate().publicKey.toBase58(),
    [mint],
  );
  const reviewed = Transaction.from(Buffer.from(result.wire, "base64"));
  expect(reviewed.feePayer?.equals(payer.publicKey)).toBe(true);
  expect(
    reviewed.signatures.find((s) => s.publicKey.equals(payer.publicKey))
      ?.signature,
  ).toBeNull();
  expect(
    reviewed.signatures.find((s) => s.publicKey.equals(mint.publicKey))
      ?.signature,
  ).not.toBeNull();
  expect(reviewed.verifySignatures(false)).toBe(true);
  expect(result.priorityFeeLamports).toBe(1400n);
  expect(transactionMessage(tx).toString("base64")).toBe(result.message);
  expect(verifyWalletTransaction(tx)).toBe(false);
  tx.partialSign(payer);
  expect(verifyWalletTransaction(tx)).toBe(true);
});

const lighthouse = new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");
it("never recompiles a correctly signed legacy message with a different account order", () => {
  const payer = Keypair.generate();
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 700,
    }),
  );
  const original = prepareTransactionWire(
    tx,
    payer.publicKey.toBase58(),
    Keypair.generate().publicKey.toBase58(),
  );
  const before = tx.compileMessage();
  // Wallet serializers may order the two readonly program keys differently.
  const keys = [...before.accountKeys];
  const a = keys.length - 1,
    b = keys.length - 2;
  [keys[a], keys[b]] = [keys[b], keys[a]];
  const remap = (i: number) => (i === a ? b : i === b ? a : i);
  const returned = new VersionedTransaction(
    new Message({
      header: before.header,
      recentBlockhash: before.recentBlockhash,
      accountKeys: keys,
      instructions: before.instructions.map((ix) => ({
        ...ix,
        programIdIndex: remap(ix.programIdIndex),
        accounts: ix.accounts.map(remap),
      })),
    }),
  );
  returned.sign([payer]);
  const wire = Buffer.from(returned.serialize()).toString("base64");
  expect(validateWalletFeeChange(original.wire, wire).wire).toBe(wire);
  expect(verifyWalletTransaction(decodeWalletTransaction(wire))).toBe(true);
  expect(
    Buffer.from(decodeWalletTransaction(wire).serialize()).toString("base64"),
  ).toBe(wire);
});
function guardedTransfer() {
  const payer = Keypair.generate(),
    recipient = Keypair.generate().publicKey;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports: 700,
    }),
  );
  const original = prepareTransactionWire(
    tx,
    payer.publicKey.toBase58(),
    Keypair.generate().publicKey.toBase58(),
  );
  // AssertAccountInfo, Silent, Lamports(700), GreaterThanOrEqual.
  const data = Buffer.alloc(12);
  data.set([5, 0, 0]);
  data.writeBigUInt64LE(700n, 3);
  data[11] = 4;
  const guard = new TransactionInstruction({
    programId: lighthouse,
    keys: [{ pubkey: recipient, isSigner: false, isWritable: false }],
    data,
  });
  tx.add(guard);
  return { payer, recipient, tx, original, guard };
}

it("preserves Phantom's signed postconditions and accepts equivalent legacy/v0 formatting", () => {
  const { payer, tx, original } = guardedTransfer();
  tx.sign(payer);
  const legacy = tx.serialize().toString("base64");
  const v0 = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: tx.recentBlockhash!,
      instructions: tx.instructions,
    }).compileToV0Message(),
  );
  v0.sign([payer]);
  for (const wire of [legacy, Buffer.from(v0.serialize()).toString("base64")]) {
    const accepted = validateWalletFeeChange(original.wire, wire);
    expect(accepted.wire).toBe(wire);
    const decoded = decodeWalletTransaction(wire);
    expect(Buffer.from(decoded.serialize()).toString("base64")).toBe(wire);
    expect(verifyWalletTransaction(decoded)).toBe(true);
  }
});

it("accepts versioned guards while keeping address lookup resolution fixed", () => {
  const { payer, recipient, tx, guard } = guardedTransfer();
  const lookup = new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: {
      deactivationSlot: 0xffffffffffffffffn,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      addresses: [recipient],
    },
  });
  const build = (instructions: TransactionInstruction[]) =>
    new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: tx.recentBlockhash!,
        instructions,
      }).compileToV0Message([lookup]),
    );
  const unsigned = build(tx.instructions.slice(0, -1));
  const signed = build(tx.instructions);
  signed.sign([payer]);
  const before = Buffer.from(unsigned.serialize()).toString("base64");
  const after = Buffer.from(signed.serialize()).toString("base64");
  expect(validateWalletFeeChange(before, after).wire).toBe(after);
  // An identical looking numeric lookup index may resolve to a different key.
  signed.message.addressTableLookups[0].accountKey =
    Keypair.generate().publicKey;
  signed.sign([payer]);
  expect(() =>
    validateWalletFeeChange(
      before,
      Buffer.from(signed.serialize()).toString("base64"),
    ),
  ).toThrow("lookups");
  expect(guard.keys[0].pubkey).toEqual(recipient);
});

it.each([
  "memory-write",
  "memory-close",
  "unknown-opcode",
  "fake-program",
  "extra-transfer",
  "changed-amount",
  "changed-recipient",
  "changed-blockhash",
  "privilege-escalation",
  "writable-guard-program",
  "guard-before-trade",
  "unsigned",
])("rejects %s even when a Lighthouse guard is present", (change) => {
  const { payer, tx, original, guard } = guardedTransfer();
  if (change === "memory-write") guard.data[0] = 0;
  if (change === "memory-close") guard.data[0] = 1;
  if (change === "unknown-opcode") guard.data[0] = 255;
  if (change === "fake-program") guard.programId = Keypair.generate().publicKey;
  if (change === "extra-transfer") tx.add(tx.instructions[2]);
  if (change === "changed-amount") tx.instructions[2].data[4] ^= 1;
  if (change === "changed-recipient")
    tx.instructions[2].keys[1].pubkey = Keypair.generate().publicKey;
  if (change === "changed-blockhash")
    tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
  if (change === "privilege-escalation")
    guard.keys[0] = {
      pubkey: SystemProgram.programId,
      isSigner: false,
      isWritable: true,
    };
  if (change === "writable-guard-program")
    guard.keys[0] = { pubkey: lighthouse, isSigner: false, isWritable: true };
  if (change === "guard-before-trade")
    tx.instructions = [guard, ...tx.instructions.slice(0, -1)];
  if (change !== "unsigned") tx.sign(payer);
  expect(() =>
    validateWalletFeeChange(
      original.wire,
      tx.serialize({ requireAllSignatures: false }).toString("base64"),
    ),
  ).toThrow();
});
it("fixes the priority fee before wallet signing and preserves an existing SDK budget", () => {
  const signer = Keypair.generate();
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 8000 }),
    SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  );
  const blockhash = Keypair.generate().publicKey.toBase58();
  const first = prepareTransactionWire(
    tx,
    signer.publicKey.toBase58(),
    blockhash,
  );
  const second = prepareTransactionWire(
    tx,
    signer.publicKey.toBase58(),
    blockhash,
  );
  expect(second.wire).toBe(first.wire);
  expect(second.priorityFeeLamports).toBe(2000n);
  expect(
    tx.instructions.filter((ix) =>
      ix.programId.equals(ComputeBudgetProgram.programId),
    ),
  ).toHaveLength(2);
  tx.sign(signer);
  expect(transactionMessage(tx).toString("base64")).toBe(first.message);
  expect(verifyWalletTransaction(tx)).toBe(true);
  // A wallet-added/changed fee is still a different message, even if signed.
  tx.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 9000,
  });
  tx.sign(signer);
  expect(verifyWalletTransaction(tx)).toBe(true);
  expect(transactionMessage(tx).toString("base64")).not.toBe(first.message);
});
it("requires every versioned signature over the exact reviewed message", () => {
  const signer = Keypair.generate(),
    to = Keypair.generate().publicKey;
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        SystemProgram.transfer({
          fromPubkey: signer.publicKey,
          toPubkey: to,
          lamports: 1,
        }),
      ],
    }).compileToV0Message(),
  );
  expect(verifyWalletTransaction(tx)).toBe(false);
  expect(() =>
    prepareTransactionWire(tx, to.toBase58(), to.toBase58()),
  ).toThrow("payer mismatch");
  const prepared = prepareTransactionWire(
    tx,
    signer.publicKey.toBase58(),
    to.toBase58(),
  );
  expect(decodeWalletTransaction(prepared.wire)).toBeInstanceOf(
    VersionedTransaction,
  );
  tx.sign([signer]);
  const decoded = decodeWalletTransaction(
    Buffer.from(tx.serialize()).toString("base64"),
  );
  expect(verifyWalletTransaction(decoded)).toBe(true);
  expect(transactionMessage(decoded)).toEqual(transactionMessage(tx));
  tx.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
  expect(verifyWalletTransaction(tx)).toBe(false);
});

it("re-reviews fee-only wallet changes without accepting altered trades", async () => {
  const { reviewWalletFeeChange } = await import("./wire");
  const payer = Keypair.generate(),
    to = Keypair.generate().publicKey;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: to,
      lamports: 7,
    }),
  );
  const original = prepareTransactionWire(
    tx,
    payer.publicKey.toBase58(),
    Keypair.generate().publicKey.toBase58(),
  );
  tx.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 2000,
  });
  tx.sign(payer);
  const changed = tx.serialize().toString("base64");
  const next = reviewWalletFeeChange(original.wire, changed);
  expect(next.priorityFeeLamports).toBe(2800n);
  expect(verifyWalletTransaction(decodeWalletTransaction(next.wire))).toBe(
    false,
  );
  expect(next.message).not.toBe(original.message);
  tx.instructions[2] = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: to,
    lamports: 8,
  });
  tx.sign(payer);
  expect(() =>
    reviewWalletFeeChange(original.wire, tx.serialize().toString("base64")),
  ).toThrow("more than the network fee");
  const feeOnly = Transaction.from(Buffer.from(changed, "base64"));
  feeOnly.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1_000_000,
  });
  feeOnly.sign(payer);
  expect(() =>
    reviewWalletFeeChange(
      original.wire,
      feeOnly.serialize().toString("base64"),
    ),
  ).toThrow("exceeds");
  feeOnly.recentBlockhash = Keypair.generate().publicKey.toBase58();
  feeOnly.sign(payer);
  expect(() =>
    reviewWalletFeeChange(
      original.wire,
      feeOnly.serialize().toString("base64"),
    ),
  ).toThrow("more than");
});

it("accepts signed fee instruction reordering but rejects account, amount and extra instruction changes", async () => {
  const { validateWalletFeeChange } = await import("./wire");
  const payer = Keypair.generate(),
    recipient = Keypair.generate().publicKey;
  const transfer = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: recipient,
    lamports: 700,
  });
  const tx = new Transaction().add(transfer);
  const original = prepareTransactionWire(
    tx,
    payer.publicKey.toBase58(),
    Keypair.generate().publicKey.toBase58(),
  );
  tx.instructions = [
    transfer,
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
  ];
  tx.sign(payer);
  const signed = tx.serialize().toString("base64");
  const valid = validateWalletFeeChange(original.wire, signed);
  expect(valid.priorityFeeLamports).toBe(600n);
  expect(valid.wire).toBe(signed);
  expect(verifyWalletTransaction(decodeWalletTransaction(valid.wire))).toBe(
    true,
  );
  for (const instruction of [
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports: 701,
    }),
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 700,
    }),
  ]) {
    tx.instructions[0] = instruction;
    tx.sign(payer);
    expect(() =>
      validateWalletFeeChange(original.wire, tx.serialize().toString("base64")),
    ).toThrow("more than");
  }
  tx.instructions[0] = transfer;
  tx.add(transfer);
  tx.sign(payer);
  expect(() =>
    validateWalletFeeChange(original.wire, tx.serialize().toString("base64")),
  ).toThrow("more than");
});

it.each([1, 4])("accepts bounded wallet compute budget opcode %s", (opcode) => {
  const { payer, tx, original } = guardedTransfer();
  const data = Buffer.alloc(5);
  data[0] = opcode;
  data.writeUInt32LE(opcode === 1 ? 65536 : 32768000, 1);
  tx.instructions.unshift(
    new TransactionInstruction({
      programId: ComputeBudgetProgram.programId,
      keys: [],
      data,
    }),
  );
  tx.sign(payer);
  const wire = tx.serialize().toString("base64");
  expect(validateWalletFeeChange(original.wire, wire).wire).toBe(wire);
  data.writeUInt32LE(0, 1);
  tx.sign(payer);
  expect(() =>
    validateWalletFeeChange(original.wire, tx.serialize().toString("base64")),
  ).toThrow();
  data.writeUInt32LE(0xffffffff, 1);
  tx.sign(payer);
  expect(() =>
    validateWalletFeeChange(original.wire, tx.serialize().toString("base64")),
  ).toThrow();
});
