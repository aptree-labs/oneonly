/** Devnet only. Check is read-only; --deploy builds/tests, deploys and initializes. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  FEE_ESCROW_PROGRAM,
  configAddress,
  decodeConfig,
  initializeConfigInstruction,
} from "../src";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = new Set(process.argv.slice(2));
for (const arg of args)
  if (!["--deploy", "--prepare", "--check"].includes(arg))
    throw new Error(`Unknown option: ${arg}`);
const rpc = "https://api.devnet.solana.com";
const connection = new Connection(rpc, "confirmed");
const GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const dir = resolve(root, ".local/fee-escrow");
const programKeyPath = resolve(dir, "program-keypair.json");
const verifierPath = resolve(dir, "verifier.json");
const bufferKeyPath = resolve(dir, "buffer-keypair.json");
const artifact = resolve(
  root,
  "packages/fee-escrow/target/deploy/oneonly_fee_escrow.so",
);
// Explicit test-only key path: never uses Solana CLI's ambient/mainnet wallet.
const deployerPath = process.env.FEE_ESCROW_DEVNET_DEPLOYER;
function run(command: string, argv: string[]) {
  execFileSync(command, argv, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}
function loadKey(path: string) {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
  );
}
async function programState(authority?: PublicKey) {
  const account = await connection.getAccountInfo(FEE_ESCROW_PROGRAM);
  if (!account) return false;
  if (
    !account.executable ||
    !account.owner.equals(loader) ||
    account.data.readUInt32LE(0) !== 2
  )
    throw new Error("Existing program is not an upgradeable executable");
  const dataKey = new PublicKey(account.data.subarray(4, 36));
  const pd = await connection.getAccountInfo(dataKey);
  if (
    !pd ||
    !pd.owner.equals(loader) ||
    pd.data.length < 45 ||
    pd.data.readUInt32LE(0) !== 3
  )
    throw new Error("Invalid program data");
  const upgradeAuthority =
    pd.data[12] === 1 ? new PublicKey(pd.data.subarray(13, 45)) : null;
  console.log(
    "Upgrade authority:",
    upgradeAuthority?.toBase58() ?? "immutable",
  );
  if (authority && !upgradeAuthority?.equals(authority))
    throw new Error(
      "Upgrade authority does not match explicit devnet deployer",
    );
  return true;
}
async function main() {
  if ((await connection.getGenesisHash()) !== GENESIS)
    throw new Error("Refusing non-devnet genesis");
  console.log("Network: devnet. Program:", FEE_ESCROW_PROGRAM.toBase58());
  if (args.has("--prepare") || args.has("--deploy")) {
    mkdirSync(resolve(root, "packages/fee-escrow/target"), { recursive: true });
    for (const [id, name] of [
      ["dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", "dbc-devnet.so"],
      ["cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", "damm-devnet.so"],
    ]) {
      const output = resolve(root, "packages/fee-escrow/target", name!);
      if (!existsSync(output))
        run("solana", ["program", "dump", "--url", rpc, id!, output]);
    }
    run("cargo", [
      "test",
      "--manifest-path",
      "packages/fee-escrow/Cargo.toml",
      "--offline",
    ]);
    run("cargo-build-sbf", [
      "--manifest-path",
      "packages/fee-escrow/program/Cargo.toml",
      "--sbf-out-dir",
      "packages/fee-escrow/target/deploy",
    ]);
    run("pnpm", ["test:fee-escrow"]);
  }
  if (existsSync(artifact))
    console.log(
      "Artifact SHA256:",
      createHash("sha256").update(readFileSync(artifact)).digest("hex"),
    );
  else
    console.log(
      "No compiled artifact; use --prepare to build and test locally.",
    );
  const deployed = await programState();
  console.log("Deployed:", deployed);
  if (!args.has("--deploy")) {
    const cfg = await connection.getAccountInfo(configAddress());
    console.log(
      "Config verifier:",
      cfg ? decodeConfig(cfg).verifier.toBase58() : "not initialized",
    );
    console.log("Read-only check complete; no transactions signed.");
    return;
  }
  if (!deployerPath)
    throw new Error(
      "Set FEE_ESCROW_DEVNET_DEPLOYER to an explicitly designated devnet-only JSON keypair",
    );
  const payer = loadKey(deployerPath);
  const programKey = loadKey(programKeyPath);
  if (!programKey.publicKey.equals(FEE_ESCROW_PROGRAM))
    throw new Error("Program keypair does not match checked-in program ID");
  if (deployed) await programState(payer.publicKey);
  const balance = await connection.getBalance(payer.publicKey);
  console.log(
    "Devnet payer:",
    payer.publicKey.toBase58(),
    "Balance (SOL):",
    balance / 1e9,
  );
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existsSync(verifierPath))
    writeFileSync(
      verifierPath,
      JSON.stringify(Array.from(Keypair.generate().secretKey)),
      { mode: 0o600, flag: "wx" },
    );
  const verifier = loadKey(verifierPath);
  const existing = await connection.getAccountInfo(configAddress());
  if (existing && !decodeConfig(existing).verifier.equals(verifier.publicKey))
    throw new Error(
      "Existing immutable verifier differs from local verifier. Stop; do not overwrite keys.",
    );
  if (!existsSync(bufferKeyPath))
    writeFileSync(
      bufferKeyPath,
      JSON.stringify(Array.from(Keypair.generate().secretKey)),
      { mode: 0o600, flag: "wx" },
    );
  run("solana", [
    "program",
    "deploy",
    "--buffer",
    bufferKeyPath,
    "--url",
    rpc,
    "--keypair",
    resolve(deployerPath),
    "--upgrade-authority",
    resolve(deployerPath),
    "--program-id",
    programKeyPath,
    artifact,
  ]);
  await programState(payer.publicKey);
  if (!existing) {
    const tx = new Transaction().add(
      initializeConfigInstruction(payer.publicKey, verifier.publicKey),
    );
    const signature = await sendAndConfirmTransaction(connection, tx, [payer], {
      commitment: "confirmed",
    });
    console.log("Config transaction:", signature);
  }
  const config = await connection.getAccountInfo(configAddress());
  if (!config || !decodeConfig(config).verifier.equals(verifier.publicKey))
    throw new Error("Post-deploy config verification failed");
  console.log(
    "Verified devnet config:",
    configAddress().toBase58(),
    "Verifier:",
    verifier.publicKey.toBase58(),
  );
  console.log(
    "Private verifier remains in ignored .local/fee-escrow/verifier.json; no mainnet action taken.",
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Devnet runner failed",
  );
  process.exitCode = 1;
});
