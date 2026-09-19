import { expect, it } from "vitest";
import {
  Keypair,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { intermediateSolInstructions } from "./route-composition";
it("keeps swap instructions and other accounts while removing only intermediate SOL funding and early cleanup", () => {
  const owner = Keypair.generate().publicKey,
    other = Keypair.generate().publicKey;
  const ata = getAssociatedTokenAddressSync(NATIVE_MINT, owner);
  const swap = new TransactionInstruction({
    programId: other,
    keys: [{ pubkey: ata, isSigner: false, isWritable: true }],
    data: Buffer.from([9]),
  });
  const otherTransfer = SystemProgram.transfer({
    fromPubkey: owner,
    toPubkey: other,
    lamports: 10,
  });
  const otherClose = createCloseAccountInstruction(
    other,
    owner,
    owner,
    [],
    TOKEN_PROGRAM_ID,
  );
  const foreignClose = createCloseAccountInstruction(ata, other, owner);
  expect(
    intermediateSolInstructions(
      [
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: ata,
          lamports: 10,
        }),
        createSyncNativeInstruction(ata),
        swap,
        otherTransfer,
        otherClose,
        foreignClose,
        createCloseAccountInstruction(ata, owner, owner),
      ],
      owner.toBase58(),
    ),
  ).toEqual([swap, otherTransfer, otherClose, foreignClose]);
});
