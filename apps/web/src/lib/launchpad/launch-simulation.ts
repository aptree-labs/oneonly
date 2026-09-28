import { VersionedTransaction, type Connection } from "@solana/web3.js";
import { LaunchError } from "@oneonly/core";

/** Catch unfundable/invalid launches before asking the wallet to sign. */
export async function validateLaunchSimulation(
  rpc: Pick<Connection, "simulateTransaction">,
  wire: string,
) {
  const { value } = await rpc.simulateTransaction(
    VersionedTransaction.deserialize(Buffer.from(wire, "base64")),
    { commitment: "confirmed", sigVerify: false },
  );
  if (!value.err) return;
  const logs = (value.logs ?? []).join("\n");
  const fundingError =
    value.err === "InsufficientFundsForFee" ||
    (typeof value.err === "object" &&
      "InsufficientFundsForRent" in value.err) ||
    /insufficient lamports|insufficient funds|insufficient.*rent/i.test(logs);
  throw new LaunchError({
    status: 400,
    message: fundingError
      ? "Not enough SOL for creation rent and network fees. Add more SOL to your connected wallet, then try again."
      : value.err === "BlockhashNotFound"
        ? "Launch preparation expired. Review your launch again."
        : "This launch failed its network check. Nothing was sent. Please try again or contact support.",
  });
}
