import { createHash } from "node:crypto";
import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Ed25519Program,
  type AccountInfo,
  type Connection,
  type AccountMeta,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

export const FEE_ESCROW_PROGRAM = new PublicKey(
  "BJk7HqbLecWFBFxFTULnmpSwmViLg9FeRLBajewvJ3g4",
);
export const CLAIM_DOMAIN = Buffer.from("oneonly:fee-claim:v1:devnet");
export const xIdHash = (id: string) => {
  if (!/^[1-9][0-9]{0,24}$/.test(id)) throw new Error("Invalid X identity");
  return createHash("sha256").update(`oneonly:x-id:v1:${id}`).digest();
};
export const discriminator = (kind: "global" | "account", name: string) =>
  createHash("sha256").update(`${kind}:${name}`).digest().subarray(0, 8);
const pda = (program: PublicKey, ...seeds: Uint8Array[]) =>
  PublicKey.findProgramAddressSync(seeds, program)[0];
export const configAddress = (program = FEE_ESCROW_PROGRAM) =>
  pda(program, Buffer.from("config"));
export const allocationAddress = (
  pool: PublicKey,
  program = FEE_ESCROW_PROGRAM,
) => pda(program, Buffer.from("allocation"), pool.toBytes());
export const ledgerAddress = (
  allocation: PublicKey,
  mint: PublicKey,
  program = FEE_ESCROW_PROGRAM,
) => pda(program, Buffer.from("ledger"), allocation.toBytes(), mint.toBytes());
export const beneficiaryAddress = (
  hash: Uint8Array,
  program = FEE_ESCROW_PROGRAM,
) => pda(program, Buffer.from("beneficiary"), hash);
export const claimedAddress = (
  ledger: PublicKey,
  hash: Uint8Array,
  program = FEE_ESCROW_PROGRAM,
) => pda(program, Buffer.from("claim"), ledger.toBytes(), hash);
export const receiptAddress = (
  nonce: Uint8Array,
  program = FEE_ESCROW_PROGRAM,
) => pda(program, Buffer.from("receipt"), nonce);
const ro = (pubkey: PublicKey, isSigner = false): AccountMeta => ({
  pubkey,
  isSigner,
  isWritable: false,
});
const rw = (pubkey: PublicKey, isSigner = false): AccountMeta => ({
  pubkey,
  isSigner,
  isWritable: true,
});
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
function instruction(
  program: PublicKey,
  name: string,
  keys: AccountMeta[],
  data: Buffer = Buffer.alloc(0),
) {
  return new TransactionInstruction({
    programId: program,
    keys,
    data: Buffer.concat([discriminator("global", name), data]),
  });
}
export function initializeConfigInstruction(
  authority: PublicKey,
  verifier: PublicKey,
  program = FEE_ESCROW_PROGRAM,
) {
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  return instruction(
    program,
    "initialize_config",
    [
      rw(authority, true),
      rw(configAddress(program)),
      ro(program),
      ro(pda(loader, program.toBytes())),
      ro(SystemProgram.programId),
    ],
    verifier.toBuffer(),
  );
}
export function initializeAllocationInstruction(args: {
  payer: PublicKey;
  pool: PublicKey;
  dbcConfig: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  shares: { xId: string; shareBps: number }[];
  transferInstruction: TransactionInstruction;
  program?: PublicKey;
}) {
  const program = args.program ?? FEE_ESCROW_PROGRAM,
    allocation = allocationAddress(args.pool, program),
    transfer = args.transferInstruction;
  if (
    transfer.keys.length !== 7 ||
    !transfer.keys[0].pubkey.equals(args.pool) ||
    !transfer.keys[2].pubkey.equals(args.payer) ||
    !transfer.keys[3].pubkey.equals(allocation)
  )
    throw new Error("Invalid Meteora authority transfer");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(args.shares.length);
  const shares = args.shares.map((s) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(s.shareBps);
    return Buffer.concat([xIdHash(s.xId), b]);
  });
  return instruction(
    program,
    "initialize_allocation",
    [
      rw(args.payer, true),
      ro(configAddress(program)),
      rw(allocation),
      rw(args.pool),
      ro(args.dbcConfig),
      ro(args.baseMint),
      ro(args.quoteMint),
      ro(transfer.programId),
      ro(transfer.keys[4].pubkey),
      ro(transfer.keys[6].pubkey),
      ro(SystemProgram.programId),
    ],
    Buffer.concat([length, ...shares]),
  );
}
export function collectFeesInstruction(args: {
  payer: PublicKey;
  pool: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseProgram: PublicKey;
  quoteProgram: PublicKey;
  venue: 0 | 1;
  meteoraInstruction: TransactionInstruction;
  program?: PublicKey;
}) {
  const program = args.program ?? FEE_ESCROW_PROGRAM,
    a = allocationAddress(args.pool, program);
  return instruction(
    program,
    "collect_fees",
    [
      rw(args.payer, true),
      ro(a),
      ro(args.baseMint),
      ro(args.quoteMint),
      rw(ledgerAddress(a, args.baseMint, program)),
      rw(ledgerAddress(a, args.quoteMint, program)),
      rw(
        getAssociatedTokenAddressSync(args.baseMint, a, true, args.baseProgram),
      ),
      rw(
        getAssociatedTokenAddressSync(
          args.quoteMint,
          a,
          true,
          args.quoteProgram,
        ),
      ),
      ro(args.baseProgram),
      ro(args.quoteProgram),
      ro(ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(SystemProgram.programId),
      ...args.meteoraInstruction.keys.map((k) => ({ ...k, isSigner: false })),
    ],
    Buffer.from([args.venue]),
  );
}
export type ClaimArgs = {
  xIdHash: Buffer;
  cumulativeLimit: bigint;
  bindingVersion: bigint;
  nonce: Buffer;
  issuedAt: bigint;
  expiresAt: bigint;
};
function claimArgs(args: ClaimArgs) {
  if (args.xIdHash.length !== 32 || args.nonce.length !== 32)
    throw new Error("Invalid claim identity or nonce");
  return Buffer.concat([
    args.xIdHash,
    u64(args.cumulativeLimit),
    u64(args.bindingVersion),
    args.nonce,
    i64(args.issuedAt),
    i64(args.expiresAt),
  ]);
}
export function claimMessage(
  args: ClaimArgs,
  allocation: PublicKey,
  mint: PublicKey,
  wallet: PublicKey,
  destination: PublicKey,
  program = FEE_ESCROW_PROGRAM,
) {
  claimArgs(args);
  return Buffer.concat([
    CLAIM_DOMAIN,
    program.toBuffer(),
    allocation.toBuffer(),
    mint.toBuffer(),
    args.xIdHash,
    wallet.toBuffer(),
    destination.toBuffer(),
    u64(args.cumulativeLimit),
    u64(args.bindingVersion),
    args.nonce,
    i64(args.issuedAt),
    i64(args.expiresAt),
  ]);
}
export function claimInstructions(args: {
  claim: ClaimArgs;
  pool: PublicKey;
  mint: PublicKey;
  wallet: PublicKey;
  tokenProgram: PublicKey;
  verifier: PublicKey;
  signature: Uint8Array;
  program?: PublicKey;
}) {
  const program = args.program ?? FEE_ESCROW_PROGRAM,
    a = allocationAddress(args.pool, program),
    ledger = ledgerAddress(a, args.mint, program),
    destination = getAssociatedTokenAddressSync(
      args.mint,
      args.wallet,
      false,
      args.tokenProgram,
    );
  const msg = claimMessage(
    args.claim,
    a,
    args.mint,
    args.wallet,
    destination,
    program,
  );
  return [
    Ed25519Program.createInstructionWithPublicKey({
      publicKey: args.verifier.toBytes(),
      message: msg,
      signature: args.signature,
    }),
    instruction(
      program,
      "claim",
      [
        rw(args.wallet, true),
        ro(configAddress(program)),
        ro(a),
        ro(ledger),
        ro(args.mint),
        rw(
          getAssociatedTokenAddressSync(args.mint, a, true, args.tokenProgram),
        ),
        rw(destination),
        rw(beneficiaryAddress(args.claim.xIdHash, program)),
        rw(claimedAddress(ledger, args.claim.xIdHash, program)),
        rw(receiptAddress(args.claim.nonce, program)),
        ro(SYSVAR_INSTRUCTIONS_PUBKEY),
        ro(args.tokenProgram),
        ro(ASSOCIATED_TOKEN_PROGRAM_ID),
        ro(SystemProgram.programId),
      ],
      claimArgs(args.claim),
    ),
  ];
}
function accountData(
  account: AccountInfo<Buffer>,
  name: string,
  size: number,
  program: PublicKey,
) {
  if (
    !account.owner.equals(program) ||
    account.data.length < size ||
    !account.data.subarray(0, 8).equals(discriminator("account", name))
  )
    throw new Error(`Invalid escrow ${name} account`);
  return account.data;
}
const key = (data: Buffer, offset: number) =>
  new PublicKey(data.subarray(offset, offset + 32));
export function decodeConfig(
  account: AccountInfo<Buffer>,
  program = FEE_ESCROW_PROGRAM,
) {
  const b = accountData(account, "Config", 41, program);
  return { verifier: key(b, 8), bump: b[40] };
}
export function decodeAllocation(
  account: AccountInfo<Buffer>,
  program = FEE_ESCROW_PROGRAM,
) {
  const b = accountData(account, "Allocation", 141, program),
    count = b.readUInt32LE(137);
  if (count < 1 || count > 8 || b.length < 141 + 34 * count)
    throw new Error("Invalid allocation shares");
  const shares = Array.from({ length: count }, (_, i) => ({
    xIdHash: b.subarray(141 + 34 * i, 173 + 34 * i),
    shareBps: b.readUInt16LE(173 + 34 * i),
  }));
  if (shares.reduce((n, s) => n + s.shareBps, 0) !== 10000)
    throw new Error("Invalid allocation total");
  return {
    pool: key(b, 8),
    baseMint: key(b, 40),
    quoteMint: key(b, 72),
    launcher: key(b, 104),
    bump: b[136],
    shares,
  };
}
export function decodeLedger(
  account: AccountInfo<Buffer>,
  program = FEE_ESCROW_PROGRAM,
) {
  const b = accountData(account, "Ledger", 80, program);
  return {
    allocation: key(b, 8),
    mint: key(b, 40),
    totalReceived: b.readBigUInt64LE(72),
  };
}
export function decodeClaimed(
  account: AccountInfo<Buffer>,
  program = FEE_ESCROW_PROGRAM,
) {
  return accountData(account, "Claimed", 16, program).readBigUInt64LE(8);
}
export function decodeBeneficiary(
  account: AccountInfo<Buffer>,
  program = FEE_ESCROW_PROGRAM,
) {
  const b = accountData(account, "Beneficiary", 80, program);
  return {
    xIdHash: b.subarray(8, 40),
    wallet: key(b, 40),
    version: b.readBigUInt64LE(72),
  };
}
export function decodeReceipt(
  account: AccountInfo<Buffer>,
  program = FEE_ESCROW_PROGRAM,
) {
  const b = accountData(account, "Receipt", 144, program);
  return {
    allocation: key(b, 8),
    mint: key(b, 40),
    wallet: key(b, 72),
    nonce: b.subarray(104, 136),
    amount: b.readBigUInt64LE(136),
  };
}
export async function readAllocation(
  connection: Connection,
  pool: PublicKey,
  program = FEE_ESCROW_PROGRAM,
) {
  const account = await connection.getAccountInfo(
    allocationAddress(pool, program),
    "confirmed",
  );
  if (!account) throw new Error("Fee allocation is not confirmed");
  return decodeAllocation(account, program);
}

export { getAssociatedTokenAddressSync } from "@solana/spl-token";
