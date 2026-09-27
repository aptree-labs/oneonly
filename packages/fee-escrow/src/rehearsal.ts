import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PublicKey } from "@solana/web3.js";
export type RehearsalReceipt = {
  version: 1;
  network: "devnet";
  program: string;
  artifactSha256: string;
  sourceSha256: string;
  substitutedSourceSha256: string;
  gitRevision: string;
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
) {
  const hash = createHash("sha256");
  for (const path of reviewedSourceFiles(packageDirectory)) {
    let contents = readFileSync(join(packageDirectory, path));
    if (path === "program/src/lib.rs" && replacementProgram)
      contents = Buffer.from(
        substituteProgram(contents.toString("utf8"), replacementProgram),
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
export function validateRehearsalReceipt(
  receipt: RehearsalReceipt,
  artifact: Buffer,
  program: PublicKey,
  packageDirectory: string,
) {
  if (
    receipt.version !== 1 ||
    receipt.network !== "devnet" ||
    receipt.claimDomain !== "oneonly:fee:v2:devnet" ||
    receipt.program !== program.toBase58() ||
    receipt.artifactSha256 !== sha(artifact) ||
    receipt.sourceSha256 !== reviewedSourceHash(packageDirectory) ||
    receipt.substitutedSourceSha256 !==
      reviewedSourceHash(packageDirectory, receipt.program) ||
    !artifact.includes(program.toBuffer()) ||
    !artifact.includes(Buffer.from(receipt.claimDomain)) ||
    !/^[a-f0-9]{40}$/.test(receipt.gitRevision)
  )
    throw new Error(
      "Rehearsal build receipt does not match the reviewed source, artifact and program identity",
    );
  return receipt;
}
