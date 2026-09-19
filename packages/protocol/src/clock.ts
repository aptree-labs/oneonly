import { SYSVAR_CLOCK_PUBKEY, type Connection } from "@solana/web3.js";
import BN from "bn.js";

/** Read the same Clock sysvar used by the programs, without querying a recent
 * block that the RPC may not have indexed yet. No local-time approximation. */
export async function chainPoint(rpc: Connection, activationType: number) {
  if (activationType !== 0 && activationType !== 1)
    throw new Error("Unsupported pool activation type.");
  const account = await rpc.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
  if (
    !account ||
    account.data.length !== 40 ||
    account.owner.toBase58() !== "Sysvar1111111111111111111111111111111111111"
  )
    throw new Error("Chain clock is unavailable. Try again.");
  const point =
    activationType === 0
      ? account.data.readBigUInt64LE(0)
      : account.data.readBigInt64LE(32);
  if (point <= 0n) throw new Error("Chain clock is invalid. Try again.");
  return new BN(point.toString());
}
