import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkNativeBigint } from "./check-native-bigint.mjs";
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "oneonly-native-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ["node_modules", "apps/web", "packages"])
    await mkdir(path.join(root, dir), { recursive: true });
  return root;
}
async function file(root, name, content = "") {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
}
test("accepts pure JavaScript bigint package and unrelated native Sharp", async (t) => {
  const root = await fixture(t);
  await file(
    root,
    "node_modules/bigint-buffer/dist/node.js",
    "throw new Error('must not execute')",
  );
  await file(root, "node_modules/sharp/build/sharp.node");
  assert.equal((await checkNativeBigint(root)).packages, 1);
});
test("rejects arbitrary native filename in symlinked package outside workspace", async (t) => {
  const root = await fixture(t),
    outside = await fixture(t);
  await file(outside, "unrelated-name/build/Release/arbitrary.node");
  await symlink(
    path.join(outside, "unrelated-name"),
    path.join(root, "node_modules/bigint-buffer"),
  );
  await assert.rejects(checkNativeBigint(root), /native addon detected/);
});
test("follows workspace dependencies without looping", async (t) => {
  const root = await fixture(t);
  await symlink(
    path.join(root, "node_modules"),
    path.join(root, "node_modules/loop"),
  );
  await file(root, "packages/core/node_modules/bigint-buffer/native.node");
  await assert.rejects(checkNativeBigint(root), /native addon detected/);
});
for (const base of [
  "apps/web/.next/standalone/node_modules",
  ".vercel/output/functions/api.func/node_modules",
  "apps/web/.vercel/output/functions/api.func/node_modules",
]) {
  test(`rejects packaged addon under ${base}`, async (t) => {
    const root = await fixture(t);
    await file(root, `${base}/bigint-buffer/build/Release/bigint_buffer.node`);
    await assert.rejects(checkNativeBigint(root), /native addon detected/);
  });
}
test("rejects addon reached by a Next trace through renamed symlink", async (t) => {
  const root = await fixture(t),
    outside = await fixture(t);
  const binary = await file(outside, "node_modules/bigint-buffer/native.node");
  const link = path.join(root, "renamed.node");
  await symlink(binary, link);
  await file(root, "apps/web/.next/BUILD_ID", "fixture");
  const traceDir = path.join(root, "apps/web/.next/server");
  await file(
    root,
    "apps/web/.next/server/page.js.nft.json",
    JSON.stringify({ files: [path.relative(traceDir, link)] }),
  );
  await assert.rejects(
    checkNativeBigint(root, { requireBuild: true }),
    /native addon detected/,
  );
});
test("rejects trace declaring addon before packaging materializes it", async (t) => {
  const root = await fixture(t);
  await file(
    root,
    "apps/web/.next/server/page.js.nft.json",
    JSON.stringify({ files: ["missing/bigint-buffer/build/native.node"] }),
  );
  await assert.rejects(checkNativeBigint(root), /native addon detected/);
});
test("fails closed for absent build, absent traces, or invalid trace", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    checkNativeBigint(root, { requireBuild: true }),
    /ENOENT/,
  );
  await file(root, "apps/web/.next/BUILD_ID", "fixture");
  await assert.rejects(
    checkNativeBigint(root, { requireBuild: true }),
    /No Next file traces/,
  );
  await file(
    root,
    "apps/web/.next/server/page.js.nft.json",
    JSON.stringify({ files: [null] }),
  );
  await assert.rejects(
    checkNativeBigint(root, { requireBuild: true }),
    /Invalid Next trace/,
  );
});
test("accepts completed traced build without native bigint code", async (t) => {
  const root = await fixture(t);
  await file(root, "apps/web/.next/BUILD_ID", "fixture");
  await file(
    root,
    "apps/web/.next/server/page.js.nft.json",
    JSON.stringify({ files: [] }),
  );
  assert.equal(
    (await checkNativeBigint(root, { requireBuild: true })).manifests,
    1,
  );
});
