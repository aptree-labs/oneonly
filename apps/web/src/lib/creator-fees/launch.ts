import {
  allocationAddress,
  readAllocation,
  xIdHash,
} from "@oneonly/fee-escrow";
import {
  PublicKey,
  connection,
  appendFeeAllocation,
  prepareTransactionWire,
} from "@oneonly/protocol";
import { validateFeeRecipients, type FeeRecipient } from "@oneonly/core";
import { creatorFeeRuntime } from "./runtime";
import { recordFeeAllocation, FeeError } from "./service";
import type { Transaction } from "@solana/web3.js";

export async function prepareLaunchAllocation(
  transaction: Transaction,
  args: {
    wallet: string;
    pool: string;
    config: string;
    mint: string;
    quoteMint: string;
    recipients: FeeRecipient[];
  },
) {
  const { program } = await creatorFeeRuntime();
  const escrow = await appendFeeAllocation(transaction, { ...args, program });
  // Include wallet-added budget instructions and every required signature slot.
  // Do this before a ticker reservation or wallet approval can be created.
  try {
    prepareTransactionWire(
      transaction,
      args.wallet,
      PublicKey.default.toBase58(),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      /too large|packet limit|encoding overruns/i.test(error.message)
    )
      throw new FeeError(
        "This launch is too large to fit in one transaction. Skip the first buy or use fewer fee recipients, then try again.",
        400,
      );
    throw error;
  }
  return JSON.stringify({
    program: program.toBase58(),
    escrow: escrow.toBase58(),
    recipients: args.recipients,
  });
}
export async function reconcileLaunchAllocation(
  token: { id: string; pool: string; mint: string; network: string },
  wallet: string,
  encoded: string | undefined,
  actualCreator: string,
) {
  if (!encoded) return wallet;
  if (
    token.network !== "devnet" ||
    process.env.ONEONLY_ENVIRONMENT !== "staging"
  )
    throw new Error("Unsupported shared fee launch environment");
  const saved = JSON.parse(encoded),
    recipients = validateFeeRecipients(saved.recipients),
    { program } = await creatorFeeRuntime(),
    pool = new PublicKey(token.pool),
    escrow = allocationAddress(pool, program);
  if (
    !recipients.length ||
    saved.program !== program.toBase58() ||
    saved.escrow !== escrow.toBase58() ||
    actualCreator !== escrow.toBase58()
  )
    throw new Error("Invalid saved fee allocation");
  const state = await readAllocation(connection(), pool, program);
  if (
    !state.pool.equals(pool) ||
    state.baseMint.toBase58() !== token.mint ||
    state.launcher.toBase58() !== wallet ||
    state.shares.length !== recipients.length ||
    state.shares.some(
      (s, i) =>
        s.shareBps !== recipients[i].shareBps ||
        !s.xIdHash.equals(xIdHash(recipients[i].xId)),
    )
  )
    throw new Error("Confirmed fee allocation does not match launch");
  await recordFeeAllocation({
    tokenId: token.id,
    network: "devnet",
    pool: token.pool,
    mint: token.mint,
    escrow: escrow.toBase58(),
    program: program.toBase58(),
    recipients,
  });
  return escrow.toBase58();
}
