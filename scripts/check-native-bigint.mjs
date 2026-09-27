import { lstat, realpath, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const packagePath = (value) =>
  value.split(/[\\/]/).some((part) => /^bigint-buffer(?:@|$)/.test(part));
const nativeAddon = (value) =>
  value.endsWith(".node") &&
  (packagePath(value) || /bigint[_-]?buffer/i.test(path.basename(value)));
/** Inspect dependencies and deployment traces without executing addons or reading env files. */
export async function checkNativeBigint(root, { requireBuild = false } = {}) {
  root = path.resolve(root);
  const visited = new Set(),
    violations = new Set();
  let manifests = 0,
    packages = 0;
  async function walk(file, required = false, withinPackage = false) {
    withinPackage ||= packagePath(file);
    let info;
    try {
      info = await lstat(file);
    } catch (error) {
      if (error.code === "ENOENT" && !required) return;
      throw error;
    }
    if (nativeAddon(file) || (withinPackage && file.endsWith(".node")))
      violations.add(file);
    const resolved = await realpath(file);
    if (nativeAddon(resolved)) violations.add(resolved);
    // Follow a link before recording its target, otherwise the target is skipped.
    if (info.isSymbolicLink()) return walk(resolved, true, withinPackage);
    const key = `${withinPackage}:${resolved}`;
    if (visited.has(key)) return;
    visited.add(key);
    if (info.isDirectory()) {
      if (path.basename(file) === "bigint-buffer") packages++;
      if (
        path.basename(file) === "cache" &&
        file.startsWith(path.join(root, "apps/web/.next"))
      )
        return;
      for (const name of await readdir(file))
        await walk(path.join(file, name), false, withinPackage);
    } else if (info.isFile() && file.endsWith(".nft.json")) {
      manifests++;
      const trace = JSON.parse(await readFile(file, "utf8"));
      if (
        !Array.isArray(trace.files) ||
        trace.files.some((entry) => typeof entry !== "string")
      )
        throw new Error(`Invalid Next trace: ${path.relative(root, file)}`);
      for (const entry of trace.files) {
        const traced = path.resolve(path.dirname(file), entry);
        if (nativeAddon(traced)) violations.add(traced);
        if (traced.endsWith(".node") || packagePath(traced)) await walk(traced);
      }
    }
  }
  if (requireBuild) await lstat(path.join(root, "apps/web/.next/BUILD_ID"));
  await walk(path.join(root, "node_modules"), true);
  for (const parent of ["apps", "packages"]) {
    for (const child of await readdir(path.join(root, parent)))
      await walk(path.join(root, parent, child, "node_modules"));
  }
  await walk(path.join(root, "apps/web/.next"));
  await walk(path.join(root, ".vercel/output"));
  await walk(path.join(root, "apps/web/.vercel/output"));
  if (requireBuild && manifests === 0)
    throw new Error(
      "No Next file traces found; cannot verify build artifacts.",
    );
  if (violations.size)
    throw new Error(
      `Vulnerable bigint-buffer native addon detected:\n${[...violations].map((file) => path.relative(root, file)).join("\n")}`,
    );
  return { packages, manifests, inspected: visited.size };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2),
    index = args.indexOf("--root");
  const root = index < 0 ? process.cwd() : args[index + 1];
  if (!root) throw new Error("--root requires a directory");
  try {
    const result = await checkNativeBigint(root, {
      requireBuild: args.includes("--require-build"),
    });
    console.log(
      `Native bigint guard passed (${result.packages} package directories, ${result.manifests} build traces).`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
