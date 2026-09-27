/** Read-only preparation; sending requires explicit signatures in the local devnet console. */
import { readFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { validateRehearsalReceipt } from "../src/rehearsal";
import { fileURLToPath } from "node:url";
import { FEE_ESCROW_PROGRAM } from "../src/index";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  createDeploymentManifest,
  deploymentCosts,
  inspectDeployment,
  serializeDeploymentManifest,
  type DeploymentManifest,
} from "../src/deployment";
import { savePrivateJson, startDeploymentConsole } from "./deployment-console";
const allowed = new Set([
  "network",
  "artifact",
  "program-key",
  "authority-plan",
  "max-total-lamports",
  "fee-ceiling-lamports",
  "out-dir",
  "rpc",
  "console",
  "rehearsal-receipt",
]);
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const name = process.argv[i]?.replace(/^--/, "");
  if (
    !name ||
    !process.argv[i]?.startsWith("--") ||
    !allowed.has(name) ||
    args.has(name)
  )
    throw new Error("Unknown or duplicate argument");
  if (name === "console") {
    args.set(name, "true");
    continue;
  }
  const value = process.argv[++i];
  if (!value || value.startsWith("--"))
    throw new Error("Missing argument value");
  args.set(name, value);
}
const required = (name: string) => {
  const value = args.get(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
};
const network = required("network") as DeploymentManifest["network"];
if (network !== "devnet" && network !== "mainnet-beta")
  throw new Error("Choose devnet or mainnet-beta");
if (args.has("console") && network !== "devnet")
  throw new Error("Mainnet signing is disabled; devnet rehearsal only");
const directory = resolve(required("out-dir"));
mkdirSync(directory, { recursive: true, mode: 0o700 });
if ((statSync(directory).mode & 0o077) !== 0)
  throw new Error("State directory must have mode 0700");
const authority = JSON.parse(
  readFileSync(resolve(required("authority-plan")), "utf8"),
);
if (typeof authority.intendedUpgradeAndClosureAuthority !== "string")
  throw new Error("Authority plan has no nominated public wallet");
const wallet = new PublicKey(authority.intendedUpgradeAndClosureAuthority);
const readCreationKey = (path: string) => {
  if ((statSync(path).mode & 0o077) !== 0)
    throw new Error("Local creation key must have mode 0600");
  const secret = JSON.parse(readFileSync(path, "utf8"));
  if (
    !Array.isArray(secret) ||
    secret.length !== 64 ||
    secret.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    throw new Error("Invalid local creation key");
  const key = Keypair.fromSecretKey(Uint8Array.from(secret));
  if (key.publicKey.equals(wallet))
    throw new Error("Never provide the nominated wallet private key");
  return key;
};
const program = readCreationKey(resolve(required("program-key")));
const artifact = readFileSync(resolve(required("artifact")));
if (args.has("rehearsal-receipt")) {
  if (network !== "devnet")
    throw new Error("Rehearsal artifacts are devnet-only");
  validateRehearsalReceipt(
    JSON.parse(readFileSync(resolve(required("rehearsal-receipt")), "utf8")),
    artifact,
    program.publicKey,
    fileURLToPath(new URL("..", import.meta.url)),
  );
} else {
  if (args.has("console"))
    throw new Error(
      "Fixed-identity artifacts do not yet have a verified build-receipt signing path. Use an isolated devnet rehearsal receipt; fixed-identity preparation is read-only.",
    );
  const declared = readFileSync(
    new URL("../program/src/lib.rs", import.meta.url),
    "utf8",
  ).match(/declare_id!\(\s*"([1-9A-HJ-NP-Za-km-z]+)"\s*\)/)?.[1];
  if (
    !program.publicKey.equals(FEE_ESCROW_PROGRAM) ||
    declared !== FEE_ESCROW_PROGRAM.toBase58()
  )
    throw new Error(
      "Creation key must match reviewed SDK/Rust identity, or supply an isolated devnet rehearsal receipt",
    );
  if (!artifact.includes(FEE_ESCROW_PROGRAM.toBuffer()))
    throw new Error("Artifact lacks the reviewed program identity");
}
const bufferPath = join(directory, "buffer-creation-key.json");
let buffer: Keypair;
if (existsSync(bufferPath)) buffer = readCreationKey(bufferPath);
else {
  buffer = Keypair.generate();
  savePrivateJson(bufferPath, Array.from(buffer.secretKey));
}
const manifest = createDeploymentManifest({
  network,
  artifact,
  wallet,
  program: program.publicKey,
  buffer: buffer.publicKey,
  maxTotalLamports: BigInt(required("max-total-lamports")),
  maxFeePerTransactionLamports: BigInt(required("fee-ceiling-lamports")),
});
const manifestPath = join(directory, "manifest.json");
if (
  existsSync(manifestPath) &&
  serializeDeploymentManifest(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  ) !== serializeDeploymentManifest(manifest)
)
  throw new Error(
    "Existing state belongs to a different plan. Do not reset a pending deployment journal.",
  );
savePrivateJson(
  manifestPath,
  JSON.parse(serializeDeploymentManifest(manifest)),
);
const rpc = new Connection(
  args.get("rpc") ??
    (network === "devnet"
      ? "https://api.devnet.solana.com"
      : "https://api.mainnet-beta.solana.com"),
  "finalized",
);
const state = await inspectDeployment(rpc, manifest, artifact),
  cost = await deploymentCosts(rpc, manifest);
console.log(
  JSON.stringify(
    {
      network,
      artifactSha256: manifest.artifactSha256,
      complete: state.complete,
      next: state.next,
      cost,
      manifestPath,
    },
    null,
    2,
  ),
);
if (args.has("console")) {
  const local = await startDeploymentConsole({
    rpc,
    manifest,
    artifact,
    localKeys: { program, buffer },
    stateDirectory: directory,
  });
  console.log(
    `Local devnet approval console is ready. Open the private URL saved in ${local.accessPath}.`,
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void local.close().then(() => process.exit(0));
    });
}
