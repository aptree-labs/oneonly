import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import {
  reviewedSourceHash,
  substituteProgram,
  validateRehearsalReceipt,
  type RehearsalReceipt,
} from "../src/rehearsal";
it("binds isolated devnet build receipt to source, substitutions, artifact and creation key", () => {
  const dir = mkdtempSync(join(tmpdir(), "oneonly-source-"));
  try {
    mkdirSync(join(dir, "program/src"), { recursive: true });
    for (const path of ["Cargo.toml", "Cargo.lock", "program/Cargo.toml"])
      writeFileSync(join(dir, path), path);
    const original = Keypair.generate().publicKey,
      program = Keypair.generate().publicKey;
    const source = `declare_id!("${original.toBase58()}");\npub const DOMAIN: &[u8] = b"oneonly:fee:v2:devnet";`;
    writeFileSync(join(dir, "program/src/lib.rs"), source);
    expect(substituteProgram(source, program.toBase58()).split("\n")[1]).toBe(
      source.split("\n")[1],
    );
    expect(() =>
      substituteProgram(source + source, program.toBase58()),
    ).toThrow("exactly one");
    const artifact = Buffer.concat([
      Buffer.from([127, 69, 76, 70]),
      program.toBuffer(),
      Buffer.from("oneonly:fee:v2:devnet"),
    ]);
    const receipt: RehearsalReceipt = {
      version: 1,
      network: "devnet",
      program: program.toBase58(),
      artifactSha256: createHash("sha256").update(artifact).digest("hex"),
      sourceSha256: reviewedSourceHash(dir),
      substitutedSourceSha256: reviewedSourceHash(dir, program.toBase58()),
      gitRevision: "a".repeat(40),
      claimDomain: "oneonly:fee:v2:devnet",
    };
    expect(validateRehearsalReceipt(receipt, artifact, program, dir)).toBe(
      receipt,
    );
    expect(() =>
      validateRehearsalReceipt(
        { ...receipt, network: "mainnet-beta" } as unknown as RehearsalReceipt,
        artifact,
        program,
        dir,
      ),
    ).toThrow();
    expect(() =>
      validateRehearsalReceipt(receipt, artifact, original, dir),
    ).toThrow();
    artifact[1] ^= 1;
    expect(() =>
      validateRehearsalReceipt(receipt, artifact, program, dir),
    ).toThrow();
    artifact[1] ^= 1;
    writeFileSync(join(dir, "program/src/lib.rs"), source + "//changed");
    expect(() =>
      validateRehearsalReceipt(receipt, artifact, program, dir),
    ).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
