/** Builds locally only. No RPC calls, wallet signing, funding or deployment. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";
import { savePrivateJson } from "./deployment-console";
import {
  reviewedSourceFiles,
  reviewedSourceHash,
  substituteReleaseSource,
  CLAIM_DOMAINS,
  validateBuildReceipt,
  type BuildReceipt,
} from "../src/rehearsal";
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(packageDirectory, "../..");
const options = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i],
    value = process.argv[i + 1];
  if (
    !["--out-dir", "--network"].includes(name!) ||
    !value ||
    options.has(name!)
  )
    throw new Error(
      "Usage: build-deployment-rehearsal.ts --out-dir PRIVATE_DIRECTORY [--network devnet|mainnet-beta]",
    );
  options.set(name!, value);
}
const network = options.get("--network") ?? "devnet";
if (network !== "devnet" && network !== "mainnet-beta")
  throw new Error("Unsupported isolated build network");
if (!options.has("--out-dir")) throw new Error("Missing --out-dir");
const output = resolve(options.get("--out-dir")!);
if (
  output === packageDirectory ||
  !output.startsWith(join(root, ".local/fee-escrow") + "/")
)
  throw new Error(
    "Rehearsal build must stay under the private .local/fee-escrow directory",
  );
mkdirSync(output, { recursive: true, mode: 0o700 });
if ((statSync(output).mode & 0o077) !== 0)
  throw new Error("Rehearsal directory must be private (0700)");
const keyPath = join(output, "program-creation-key.json");
let program: Keypair;
if (existsSync(keyPath)) {
  if ((statSync(keyPath).mode & 0o077) !== 0)
    throw new Error("Creation key must have mode 0600");
  program = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))),
  );
} else {
  program = Keypair.generate();
  savePrivateJson(keyPath, Array.from(program.secretKey));
}
const sourceHash = reviewedSourceHash(packageDirectory);
const sourceDirectory = join(output, "source");
const expectedSources = new Set(reviewedSourceFiles(packageDirectory));
// Refuse stale/extra build scripts or symlinks in a reused scratch source tree.
function validateScratch(directory: string, prefix = "") {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink())
      throw new Error("Scratch source symlinks are forbidden");
    if (entry.isDirectory()) validateScratch(join(directory, entry.name), path);
    else if (!expectedSources.has(path))
      throw new Error(
        "Unexpected scratch build input; use a new rehearsal directory",
      );
  }
}
validateScratch(sourceDirectory);
for (const path of expectedSources) {
  let contents = readFileSync(join(packageDirectory, path));
  if (path === "program/src/lib.rs")
    contents = Buffer.from(
      substituteReleaseSource(
        contents.toString("utf8"),
        program.publicKey.toBase58(),
        network,
      ),
    );
  const target = join(sourceDirectory, path);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, contents, { mode: 0o600 });
}
const artifactDirectory = join(output, "build");
mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
console.log(
  `Building isolated ${network} artifact. No transactions will be sent.`,
);
execFileSync(
  "cargo-build-sbf",
  [
    "--manifest-path",
    join(sourceDirectory, "program/Cargo.toml"),
    "--sbf-out-dir",
    artifactDirectory,
  ],
  {
    cwd: sourceDirectory,
    stdio: "inherit",
    env: {
      ...process.env,
      CARGO_NET_OFFLINE: "true",
      CARGO_TARGET_DIR: join(output, "target"),
    },
  },
);
if (reviewedSourceHash(packageDirectory) !== sourceHash)
  throw new Error(
    "Reviewed source changed during build; rebuild before approving",
  );
const artifact = readFileSync(join(artifactDirectory, "oneonly_fee_escrow.so"));
const receipt: BuildReceipt = {
  version: 1,
  network,
  program: program.publicKey.toBase58(),
  artifactSha256: createHash("sha256").update(artifact).digest("hex"),
  sourceSha256: sourceHash,
  substitutedSourceSha256: reviewedSourceHash(sourceDirectory),
  gitRevision: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  claimDomain: CLAIM_DOMAINS[network],
};
validateBuildReceipt(
  receipt,
  artifact,
  program.publicKey,
  packageDirectory,
  network,
);
savePrivateJson(join(output, "build-receipt.json"), receipt);
console.log(
  JSON.stringify(
    {
      network,
      artifactSha256: receipt.artifactSha256,
      sourceSha256: receipt.sourceSha256,
      receiptPath: join(output, "build-receipt.json"),
    },
    null,
    2,
  ),
);
