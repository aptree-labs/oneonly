import { readFile, writeFile } from "node:fs/promises";
import {
  Connection,
  PublicKey,
} from "../packages/protocol/node_modules/@solana/web3.js";
import { createHash } from "node:crypto";
async function main() {
  const rpc = new Connection(
    "https://api.mainnet-beta.solana.com",
    "finalized",
  );
  const route = JSON.parse(
    await readFile(".data/mainnet-fork/jupiter-build.json", "utf8"),
  );
  const instructions = [
    ...route.setupInstructions,
    route.swapInstruction,
    ...(route.cleanupInstruction ? [route.cleanupInstruction] : []),
  ];
  const keys = [
    ...new Set<string>([
      ...instructions.flatMap((ix) => [
        ix.programId,
        ...ix.accounts.map((a) => a.pubkey),
      ]),
      ...Object.keys(route.addressesByLookupTableAddress ?? {}),
    ]),
  ];
  const { context, value: accounts } =
    await rpc.getMultipleAccountsInfoAndContext(
      keys.map((key) => new PublicKey(key)),
    );
  const manifest = [];
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i],
      key = keys[i];
    if (
      !account ||
      key.startsWith("Sysvar") ||
      key === "11111111111111111111111111111111"
    )
      continue;
    if (account.executable) {
      if (
        account.owner.toBase58() !==
        "BPFLoaderUpgradeab1e11111111111111111111111"
      )
        continue;
      const data = await rpc.getAccountInfo(
        new PublicKey(account.data.subarray(4, 36)),
      );
      if (
        !data ||
        data.data.length > 20_000_045 ||
        data.data.readUInt32LE(0) !== 3
      )
        throw new Error("Invalid program data or fixture size cap exceeded");
      const binary = data.data.subarray(45);
      await writeFile(`.data/mainnet-fork/programs/${key}.so`, binary);
      manifest.push({
        program: key,
        bytes: binary.length,
        sha256: createHash("sha256").update(binary).digest("hex"),
      });
    } else {
      await writeFile(
        `.data/mainnet-fork/accounts/${key}.json`,
        JSON.stringify({
          pubkey: key,
          account: {
            ...account,
            owner: account.owner.toBase58(),
            data: [account.data.toString("base64"), "base64"],
          },
        }),
      );
    }
  }
  await writeFile(
    ".data/mainnet-fork/jupiter-programs.json",
    JSON.stringify(
      {
        slot: context.slot,
        unixTimestamp: await rpc.getBlockTime(context.slot),
        programs: manifest,
      },
      null,
      2,
    ),
  );
  console.log(
    "Copied route accounts and",
    manifest.length,
    "public programs for memory-only testing.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
