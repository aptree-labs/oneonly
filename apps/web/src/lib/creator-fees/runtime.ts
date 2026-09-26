import {
  FEE_ESCROW_PROGRAM,
  configAddress,
  decodeConfig,
} from "@oneonly/fee-escrow";
import {
  PublicKey,
  Keypair,
  NETWORK,
  connection,
  assertNetwork,
} from "@oneonly/protocol";
import { fail } from "../launchpad/auth";

/** Opt in only after the deployed devnet program has passed integration checks. */
export async function creatorFeeRuntime() {
  if (
    process.env.ONEONLY_ENVIRONMENT !== "staging" ||
    NETWORK !== "devnet" ||
    process.env.CREATOR_FEES_ENABLED !== "true"
  )
    return fail("Creator fee sharing is not enabled in this environment.", 503);
  let program: PublicKey, verifier: PublicKey;
  try {
    program = new PublicKey(process.env.CREATOR_FEE_PROGRAM_ID || "");
    verifier = new PublicKey(process.env.CREATOR_FEE_VERIFIER_PUBLIC_KEY || "");
    if (!PublicKey.isOnCurve(verifier.toBytes()))
      throw new Error("Invalid verifier");
  } catch {
    return fail("Creator fee verification is not configured yet.", 503);
  }
  if (!program.equals(FEE_ESCROW_PROGRAM))
    return fail("Unsupported fee escrow program.", 503);
  // Do not ask recipients to publish a post until this deployment can sign
  // the resulting claim. This key remains server-only and is never returned.
  try {
    const bytes = JSON.parse(
      process.env.CREATOR_FEE_VERIFIER_SECRET_KEY || "null",
    );
    if (
      !Array.isArray(bytes) ||
      bytes.length !== 64 ||
      !bytes.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
    )
      throw new Error();
    if (
      !Keypair.fromSecretKey(Uint8Array.from(bytes)).publicKey.equals(verifier)
    )
      throw new Error();
  } catch {
    return fail("Claim verification signing is not configured.", 503);
  }
  await assertNetwork();
  const account = await connection().getAccountInfo(program, "confirmed");
  if (!account?.executable)
    return fail("Creator fee escrow is not available yet.", 503);
  const config = await connection().getAccountInfo(
    configAddress(program),
    "confirmed",
  );
  if (!config || !decodeConfig(config, program).verifier.equals(verifier))
    return fail("Fee verifier does not match the deployed program.", 503);
  return { program, verifier };
}
