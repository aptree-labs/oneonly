import {
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

/** An intermediate WSOL account is funded by the preceding swap, and closed only after both legs. */
export function intermediateSolInstructions(
  instructions: TransactionInstruction[],
  wallet: string,
) {
  const owner = new PublicKey(wallet),
    ata = getAssociatedTokenAddressSync(NATIVE_MINT, owner);
  return instructions.filter((ix) => {
    if (
      ix.programId.equals(SystemProgram.programId) &&
      ix.data.length === 12 &&
      ix.data.readUInt32LE(0) === 2 &&
      ix.keys[0]?.pubkey.equals(owner) &&
      ix.keys[1]?.pubkey.equals(ata)
    )
      return false;
    if (
      ix.programId.equals(TOKEN_PROGRAM_ID) &&
      ix.data.length === 1 &&
      ix.keys[0]?.pubkey.equals(ata)
    ) {
      if (ix.data[0] === 17) return false;
      if (
        ix.data[0] === 9 &&
        ix.keys[1]?.pubkey.equals(owner) &&
        ix.keys[2]?.pubkey.equals(owner)
      )
        return false;
    }
    return true;
  });
}
