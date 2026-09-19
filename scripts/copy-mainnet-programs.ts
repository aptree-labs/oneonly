import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  Connection,
  PublicKey,
} from "../packages/protocol/node_modules/@solana/web3.js";
import {
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  METAPLEX_PROGRAM_ID,
} from "../packages/protocol/node_modules/@meteora-ag/dynamic-bonding-curve-sdk";
import { TOKEN_2022_PROGRAM_ID } from "../packages/protocol/node_modules/@solana/spl-token";
import { GENESIS_HASHES } from "../packages/core/src/network";
async function main() {
  const rpc = new Connection(
    "https://api.mainnet-beta.solana.com",
    "finalized",
  );
  if ((await rpc.getGenesisHash()) !== GENESIS_HASHES["mainnet-beta"])
    throw new Error("Wrong source chain");
  await mkdir(".data/mainnet-fork/programs", { recursive: true });
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const evidence = [];
  for (const address of [
    DYNAMIC_BONDING_CURVE_PROGRAM_ID,
    DAMM_V2_PROGRAM_ID,
    METAPLEX_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
  ]) {
    const program = await rpc.getAccountInfo(address);
    if (
      !program?.executable ||
      !program.owner.equals(loader) ||
      program.data.readUInt32LE(0) !== 2
    )
      throw new Error("Unexpected program layout");
    const dataAddress = new PublicKey(program.data.subarray(4, 36));
    const data = await rpc.getAccountInfo(dataAddress);
    if (!data?.owner.equals(loader) || data.data.readUInt32LE(0) !== 3)
      throw new Error("Invalid program data");
    const binary = data.data.subarray(45);
    if (binary.length > 20_000_000)
      throw new Error("Program exceeds local fixture size cap");
    await writeFile(`.data/mainnet-fork/programs/${address}.so`, binary);
    evidence.push({
      program: address.toBase58(),
      programData: dataAddress.toBase58(),
      deploymentSlot: data.data.readBigUInt64LE(4).toString(),
      bytes: binary.length,
      sha256: createHash("sha256").update(binary).digest("hex"),
    });
    console.log(
      "Copied public program",
      address.toBase58(),
      binary.length,
      "bytes",
    );
  }
  await writeFile(
    ".data/mainnet-fork/programs/manifest.json",
    JSON.stringify(evidence, null, 2),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
