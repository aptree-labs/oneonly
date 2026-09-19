import { createPublicKey, verify } from "node:crypto";
import {
  Transaction,
  VersionedTransaction,
  PublicKey,
  ComputeBudgetProgram,
  type Keypair,
} from "@solana/web3.js";
export type WalletTransaction = Transaction | VersionedTransaction;
/** SDKs externalized by Next can carry a separate web3 constructor identity. */
export function isLegacyTransaction(tx: WalletTransaction): tx is Transaction {
  return typeof (tx as Transaction).serializeMessage === "function";
}
export function prepareTransactionWire(
  tx: WalletTransaction,
  wallet: string,
  blockhash: string,
  signers: Keypair[] = [],
) {
  if (isLegacyTransaction(tx)) {
    // Unsigned swaps otherwise allow wallet-added priority fees to change the
    // reviewed message. Set the budget before signing or persisting the intent.
    const budget = tx.instructions.filter((ix) =>
      ix.programId.equals(ComputeBudgetProgram.programId),
    );
    const missing = [];
    if (!budget.some((ix) => ix.data[0] === 2))
      missing.push(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      );
    if (!budget.some((ix) => ix.data[0] === 3))
      missing.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
      );
    tx.instructions.unshift(...missing);
    tx.feePayer = new PublicKey(wallet);
    tx.recentBlockhash = blockhash;
    if (signers.length) tx.partialSign(...signers);
  } else {
    if (tx.message.staticAccountKeys[0].toBase58() !== wallet)
      throw new Error("Transaction payer mismatch.");
    tx.message.recentBlockhash = blockhash;
    if (signers.length) tx.sign(signers);
  }
  const bytes = Buffer.from(
    isLegacyTransaction(tx)
      ? tx.serialize({ requireAllSignatures: false, verifySignatures: false })
      : tx.serialize(),
  );
  if (bytes.length > 1232)
    throw new Error("Transaction exceeds Solana's packet limit.");
  const decoded = VersionedTransaction.deserialize(bytes);
  const budgetData = decoded.message.compiledInstructions
    .filter((ix) =>
      decoded.message.staticAccountKeys[ix.programIdIndex]?.equals(
        ComputeBudgetProgram.programId,
      ),
    )
    .map((ix) => Buffer.from(ix.data));
  const units = budgetData.find((data) => data[0] === 2)?.readUInt32LE(1);
  const price = budgetData.find((data) => data[0] === 3)?.readBigUInt64LE(1);
  const priorityFeeLamports =
    units !== undefined && price !== undefined
      ? (BigInt(units) * price + 999_999n) / 1_000_000n
      : null;
  return {
    wire: bytes.toString("base64"),
    message: transactionMessage(tx).toString("base64"),
    priorityFeeLamports,
  };
}
export function decodeWalletTransaction(wire: string): WalletTransaction {
  const bytes = Buffer.from(wire, "base64");
  if (bytes.length > 1232)
    throw new Error("Transaction exceeds Solana's packet limit.");
  // Also accepts legacy messages, without recompiling their account order or
  // permissions. Never reconstruct a message after the wallet has signed it.
  return VersionedTransaction.deserialize(bytes);
}
export function transactionMessage(tx: WalletTransaction): Buffer {
  return Buffer.from(
    isLegacyTransaction(tx) ? tx.serializeMessage() : tx.message.serialize(),
  );
}
export function verifyWalletTransaction(tx: WalletTransaction): boolean {
  if (isLegacyTransaction(tx)) return tx.verifySignatures();
  const message = transactionMessage(tx);
  return (
    tx.signatures.length === tx.message.header.numRequiredSignatures &&
    tx.signatures.every((signature, i) => {
      const key = createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          tx.message.staticAccountKeys[i].toBuffer(),
        ]),
        format: "der",
        type: "spki",
      });
      return verify(null, message, key, signature);
    })
  );
}

const LIGHTHOUSE = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
export function hasWalletSafetyAssertions(wire: string): boolean {
  const { message } = VersionedTransaction.deserialize(
    Buffer.from(wire, "base64"),
  );
  return message.compiledInstructions.some(
    (ix) =>
      message.staticAccountKeys[ix.programIdIndex]?.toBase58() === LIGHTHOUSE,
  );
}
// Lighthouse instruction.rs at 4c579479c98635e419b1b167f08be02a71604a71:
// single-account data/info/token assertions, including their multi variants.
// Never allow MemoryWrite (0), MemoryClose (1), arbitrary programs or CPI guards.
const READ_ONLY_ASSERTIONS = new Set([2, 3, 5, 6, 9, 10]);

/** Preserve trade effects while accepting bounded fees and wallet safety assertions. */
export function validateWalletFeeChange(original: string, signed: string) {
  if (
    Buffer.byteLength(original, "base64") > 1232 ||
    Buffer.byteLength(signed, "base64") > 1232
  )
    throw new Error("Transaction exceeds Solana’s packet limit.");
  const before = VersionedTransaction.deserialize(
    Buffer.from(original, "base64"),
  );
  const after = VersionedTransaction.deserialize(Buffer.from(signed, "base64"));
  if (!verifyWalletTransaction(after))
    throw new Error("Invalid wallet signature.");
  const originalKeys = new Set(
    before.message.staticAccountKeys.map((key) => key.toBase58()),
  );
  const allowGuards = !before.message.compiledInstructions.some(
    (ix) =>
      before.message.staticAccountKeys[ix.programIdIndex]?.toBase58() ===
      LIGHTHOUSE,
  );
  const describe = (tx: VersionedTransaction, walletAdditions = false) => {
    let units: number | undefined, price: bigint | undefined;
    const memoryBudgets = new Set<number>();
    const guardKeys = new Set<string>();
    let sawGuard = false;
    let misplacedGuard = false;
    const message = tx.message;
    const key = (index: number) =>
      index < message.staticAccountKeys.length
        ? message.staticAccountKeys[index].toBase58()
        : `lookup:${index - message.staticAccountKeys.length}`;
    const instructions = message.compiledInstructions.flatMap((ix) => {
      const data = Buffer.from(ix.data);
      if (
        message.staticAccountKeys[ix.programIdIndex]?.equals(
          ComputeBudgetProgram.programId,
        ) &&
        ix.accountKeyIndexes.length === 0
      ) {
        if (data[0] === 2 && data.length === 5 && units === undefined) {
          units = data.readUInt32LE(1);
          return [];
        }
        if (data[0] === 3 && data.length === 9 && price === undefined) {
          price = data.readBigUInt64LE(1);
          return [];
        }
        // Wallets also tune heap/account-data budgets. These only constrain
        // execution; they do not change recipients or transfer amounts.
        if (data.length === 5 && !memoryBudgets.has(data[0])) {
          const bytes = data.readUInt32LE(1);
          if (
            (data[0] === 1 &&
              bytes >= 32768 &&
              bytes <= 262144 &&
              bytes % 1024 === 0) ||
            (data[0] === 4 && bytes > 0 && bytes <= 67108864)
          ) {
            memoryBudgets.add(data[0]);
            return [];
          }
        }
      }
      if (
        walletAdditions &&
        allowGuards &&
        key(ix.programIdIndex) === LIGHTHOUSE &&
        READ_ONLY_ASSERTIONS.has(data[0]) &&
        data.length >= 3 &&
        ix.accountKeyIndexes.length === 1
      ) {
        sawGuard = true;
        guardKeys.add(LIGHTHOUSE);
        guardKeys.add(key(ix.accountKeyIndexes[0]));
        return [];
      }
      // Accept appended postconditions, never an insertion ahead of a trade.
      if (sawGuard) misplacedGuard = true;
      return [
        {
          program: key(ix.programIdIndex),
          accounts: ix.accountKeyIndexes.map(key),
          data: data.toString("base64"),
        },
      ];
    });
    return {
      units,
      price,
      shape: {
        // Legacy and v0 without lookup tables have equivalent execution here.
        // All accounts, privileges, instructions and lookup tables still match.
        payer: message.staticAccountKeys[0].toBase58(),
        keys: message.staticAccountKeys
          .map((key, index) => ({
            key: key.toBase58(),
            signer: message.isAccountSigner(index),
            writable: message.isAccountWritable(index),
          }))
          .filter(
            (account) =>
              !(
                walletAdditions &&
                guardKeys.has(account.key) &&
                !originalKeys.has(account.key) &&
                !account.signer &&
                !account.writable
              ),
          )
          .sort((a, b) => a.key.localeCompare(b.key)),
        blockhash: message.recentBlockhash,
        lookups: message.addressTableLookups,
        instructions,
        misplacedGuard,
      },
    };
  };
  const a = describe(before),
    b = describe(after, true);
  const fields = Object.keys(a.shape) as (keyof typeof a.shape)[];
  const changed = fields.filter(
    (field) =>
      JSON.stringify(a.shape[field]) !== JSON.stringify(b.shape[field]),
  );
  if (
    changed.length ||
    b.units === undefined ||
    b.price === undefined ||
    b.units < 1 ||
    b.units > 1_400_000
  )
    throw new Error(
      `The wallet changed more than the network fee (${changed.length ? changed.join(", ") : "compute budget"}). Nothing was sent. Request a fresh quote.`,
    );
  const priorityFeeLamports =
    (BigInt(b.units) * b.price + 999_999n) / 1_000_000n;
  if (priorityFeeLamports > 100_000n)
    throw new Error(
      "The wallet fee exceeds 0.0001 SOL. Lower the priority fee and try again.",
    );

  const bytes = after.serialize();
  if (bytes.length > 1232)
    throw new Error("Transaction exceeds Solana's packet limit.");
  return {
    wire: Buffer.from(bytes).toString("base64"),
    message: Buffer.from(after.message.serialize()).toString("base64"),
    priorityFeeLamports,
  };
}

/** Existing review callers still receive an unsigned transaction for a fresh approval. */
export function reviewWalletFeeChange(original: string, signed: string) {
  const result = validateWalletFeeChange(original, signed);
  const tx = VersionedTransaction.deserialize(
    Buffer.from(result.wire, "base64"),
  );
  tx.signatures = tx.signatures.map(() => new Uint8Array(64));
  return { ...result, wire: Buffer.from(tx.serialize()).toString("base64") };
}
