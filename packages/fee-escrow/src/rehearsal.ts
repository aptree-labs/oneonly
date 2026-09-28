import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PublicKey } from "@solana/web3.js";
export const CLAIM_DOMAINS = {
  devnet: "oneonly:fee:v2:devnet",
  "mainnet-beta": "oneonly:fee:v2:mainnet-beta",
} as const;
export type BuildReceipt = {
  version: 1;
  network: keyof typeof CLAIM_DOMAINS;
  program: string;
  artifactSha256: string;
  sourceSha256: string;
  substitutedSourceSha256: string;
  gitRevision: string;
  claimDomain: (typeof CLAIM_DOMAINS)[keyof typeof CLAIM_DOMAINS];
};
export type RehearsalReceipt = BuildReceipt & {
  network: "devnet";
  claimDomain: "oneonly:fee:v2:devnet";
};
const sha = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
export function reviewedSourceFiles(packageDirectory: string) {
  const files = ["Cargo.toml", "Cargo.lock", "program/Cargo.toml"];
  function walk(relative: string) {
    for (const entry of readdirSync(join(packageDirectory, relative), {
      withFileTypes: true,
    })) {
      if (entry.isSymbolicLink())
        throw new Error("Build source symlinks are not supported");
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  walk("program/src");
  return files.sort();
}
export function reviewedSourceHash(
  packageDirectory: string,
  replacementProgram?: string,
  network: keyof typeof CLAIM_DOMAINS = "devnet",
) {
  const hash = createHash("sha256");
  for (const path of reviewedSourceFiles(packageDirectory)) {
    let contents = readFileSync(join(packageDirectory, path));
    if (path === "program/src/lib.rs" && replacementProgram)
      contents = Buffer.from(
        substituteReleaseSource(
          contents.toString("utf8"),
          replacementProgram,
          network,
        ),
      );
    hash.update(path).update("\0").update(contents).update("\0");
  }
  return hash.digest("hex");
}
export function substituteProgram(source: string, program: string) {
  new PublicKey(program);
  const expression = /declare_id!\(\s*"([1-9A-HJ-NP-Za-km-z]+)"\s*\)/g;
  const matches = [...source.matchAll(expression)];
  if (matches.length !== 1)
    throw new Error("Expected exactly one program declaration");
  return source.replace(expression, `declare_id!("${program}")`);
}
export function substituteReleaseSource(
  source: string,
  program: string,
  network: keyof typeof CLAIM_DOMAINS,
) {
  const updated = substituteProgram(source, program);
  if (network === "devnet") return updated;
  if (
    network !== "mainnet-beta" ||
    updated.split('b"oneonly:fee:v2:devnet"').length !== 2
  )
    throw new Error(
      "Expected exactly one reviewed devnet claim-domain declaration",
    );
  return updated.replace(
    'b"oneonly:fee:v2:devnet"',
    'b"oneonly:fee:v2:mainnet-beta"',
  );
}
export function buildReceiptDigest(receipt: BuildReceipt) {
  return sha(
    JSON.stringify({
      version: receipt.version,
      network: receipt.network,
      program: receipt.program,
      artifactSha256: receipt.artifactSha256,
      sourceSha256: receipt.sourceSha256,
      substitutedSourceSha256: receipt.substitutedSourceSha256,
      gitRevision: receipt.gitRevision,
      claimDomain: receipt.claimDomain,
    }),
  );
}
export function validateBuildReceipt(
  receipt: BuildReceipt,
  artifact: Buffer,
  program: PublicKey,
  packageDirectory: string,
  network: keyof typeof CLAIM_DOMAINS,
) {
  if (
    receipt.version !== 1 ||
    receipt.network !== network ||
    receipt.claimDomain !== CLAIM_DOMAINS[network] ||
    receipt.program !== program.toBase58() ||
    receipt.artifactSha256 !== sha(artifact) ||
    receipt.sourceSha256 !== reviewedSourceHash(packageDirectory) ||
    receipt.substitutedSourceSha256 !==
      reviewedSourceHash(packageDirectory, receipt.program, network) ||
    !artifact.includes(program.toBuffer()) ||
    !artifact.includes(Buffer.from(receipt.claimDomain)) ||
    (network === "mainnet-beta" &&
      artifact.includes(Buffer.from(CLAIM_DOMAINS.devnet))) ||
    !/^[a-f0-9]{40}$/.test(receipt.gitRevision)
  )
    throw new Error(
      "Build receipt does not match the reviewed source, artifact, network and program identity",
    );
  return receipt;
}
export function validateRehearsalReceipt(
  receipt: RehearsalReceipt,
  artifact: Buffer,
  program: PublicKey,
  packageDirectory: string,
) {
  return validateBuildReceipt(
    receipt,
    artifact,
    program,
    packageDirectory,
    "devnet",
  );
}
