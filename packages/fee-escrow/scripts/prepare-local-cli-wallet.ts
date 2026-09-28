/** Explicit local CLI key conversion. Never prints or uploads private material. */
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { Keypair, PublicKey } from "@solana/web3.js";
const requireWeb = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
);
const bs58 = requireWeb("bs58").default;
const args = process.argv.slice(2);
function option(name: string) {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1])
    throw new Error("Missing required local-wallet argument");
  return args[i + 1]!;
}
function privateRead(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.mode & 0o077 || stat.size > 4096)
      throw new Error("Key file must be a private regular file under 4 KB");
    return readFileSync(fd, "utf8").trim();
  } finally {
    closeSync(fd);
  }
}
try {
  const input = resolve(option("--input"));
  const output = resolve(option("--output"));
  const expected = new PublicKey(option("--expected-wallet"));
  if (input === output || dirname(input) !== dirname(output))
    throw new Error(
      "Use separate input/output files in the same private folder",
    );
  const text = privateRead(input);
  if (!text) throw new Error("The private key input file is still empty");
  let bytes: Uint8Array;
  try {
    if (text.startsWith("[")) {
      const values: unknown = JSON.parse(text);
      if (
        !Array.isArray(values) ||
        values.length !== 64 ||
        values.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
      )
        throw new Error();
      bytes = Uint8Array.from(values);
    } else bytes = bs58.decode(text);
    if (bytes.length !== 64) throw new Error();
  } catch {
    throw new Error(
      "Expected a base58 private key or 64-number Solana JSON keypair; do not provide a recovery phrase",
    );
  }
  const wallet = Keypair.fromSecretKey(bytes);
  if (!wallet.publicKey.equals(expected))
    throw new Error(
      "Key does not match the nominated deployment wallet; nothing was written",
    );
  if (existsSync(output)) {
    const prior = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(privateRead(output))),
    );
    if (!prior.publicKey.equals(expected))
      throw new Error("Existing CLI key file belongs to a different wallet");
  } else
    writeFileSync(output, JSON.stringify([...wallet.secretKey]), {
      flag: "wx",
      mode: 0o600,
    });
  bytes.fill(0);
  console.log(
    "Nominated wallet verified. Private CLI keypair is ready; no transaction signed or sent.",
  );
} catch (error) {
  // Only controlled diagnostics; never stringify input, parsed data or a stack.
  const allowed =
    error instanceof Error &&
    /^(Missing required|Key file must|Use separate|The private key input|Expected a base58|Key does not match|Existing CLI key file)/.test(
      error.message,
    );
  console.error(
    allowed
      ? (error as Error).message
      : "Local key preparation failed. Check file permissions and exported key format.",
  );
  process.exitCode = 1;
}
