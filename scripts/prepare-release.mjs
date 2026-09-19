import { cp, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const surface = process.argv[2];
if (!["app", "landing"].includes(surface))
  throw new Error("Use: node scripts/prepare-release.mjs app|landing");
const source = process.cwd(),
  target = await mkdtemp(path.join(tmpdir(), `oneonly-${surface}-`));
const excluded = new Set([
  "node_modules",
  ".git",
  ".vercel",
  ".next",
  ".data",
  ".agents",
  ".codex",
  "assets",
  "test-results",
  "playwright-report",
]);
await cp(source, target, {
  recursive: true,
  filter: (file) => {
    const relative = path.relative(source, file);
    return !relative
      .split(path.sep)
      .some((part) => excluded.has(part) || part.startsWith(".env"));
  },
});
if (surface === "landing")
  for (const relative of [
    "apps/web/src/app/app",
    "apps/web/src/app/api/launchpad",
    "apps/web/src/lib/launchpad",
    "apps/web/src/components/launchpad",
    "apps/web/src/proxy.ts",
  ]) {
    await rm(path.join(target, relative), { recursive: true, force: true });
  }
if (surface === "app")
  await cp(
    path.join(source, "deployment/app.vercel.json"),
    path.join(target, "apps/web/vercel.json"),
  );
await mkdir(path.join(target, ".vercel"));
await writeFile(
  path.join(target, ".vercel/project.json"),
  JSON.stringify({
    projectId:
      surface === "app"
        ? "prj_u37mxkwsRpLM4PDpgDq6Tx6y1eUk"
        : "prj_RMgR69Cjes1wIX4tgKgsBT2O15HS",
    orgId: "team_1XHfnqeeOvvK7IvZsPBtu5bM",
    projectName: surface === "app" ? "oneonly-app" : "oneonly",
  }),
);
console.log(target);
