import {
  assertNetwork,
  configuredPool,
  quoteAssets,
  NETWORK,
} from "../packages/protocol/src/index";

/** Read-only preflight. No configuration, account, transaction or deployment is created. */
async function main() {
  const checks: {
    check: string;
    status: "PASS" | "BLOCKED" | "PENDING";
    detail: string;
  }[] = [];
  try {
    await assertNetwork();
    checks.push({
      check: "Transaction network",
      status: "PASS",
      detail: NETWORK,
    });
  } catch {
    checks.push({
      check: "Transaction network",
      status: "BLOCKED",
      detail: "RPC network mismatch or unavailable",
    });
  }
  for (const asset of quoteAssets()) {
    try {
      await configuredPool(asset.symbol);
      checks.push({
        check: `${asset.symbol} pool`,
        status: "PASS",
        detail:
          "Mint, decimals, immutable supply, fees and migration destination verified",
      });
    } catch (error) {
      checks.push({
        check: `${asset.symbol} pool`,
        status: "BLOCKED",
        detail: error instanceof Error ? error.message : "Verification failed",
      });
    }
  }
  const stocks = quoteAssets().filter((asset) => asset.category === "Stocks");
  checks.push({
    check: "Five stock assets",
    status: stocks.length === 5 ? "PASS" : "PENDING",
    detail: `${stocks.length}/5 configured; official issuer mints and network-matched DBC configs required`,
  });
  for (const [key, label] of [
    [
      NETWORK === "mainnet-beta" ? "MAINNET_DATABASE_URL" : "DATABASE_URL",
      "Persistent database",
    ],
    ["CRON_SECRET", "Authenticated indexer"],
    ["LAUNCHPAD_URL", "App origin"],
  ])
    checks.push({
      check: label,
      status:
        process.env[key] && process.env[key] !== "[SENSITIVE]"
          ? "PASS"
          : "PENDING",
      detail:
        process.env[key] && process.env[key] !== "[SENSITIVE]"
          ? "Configured; secret value hidden"
          : "Not set in this environment",
    });
  if (quoteAssets().some((asset) => asset.referenceMint))
    checks.push({
      check: "Extra asset price service",
      status: process.env.JUPITER_API_KEY ? "PASS" : "PENDING",
      detail: process.env.JUPITER_API_KEY
        ? "API key configured; live freshness is verified per quote"
        : "Keyless pricing/routing is supported; configure a key for production capacity",
    });
  if (process.argv.includes("--mainnet") || NETWORK === "mainnet-beta") {
    checks.push({
      check: "Mainnet network selection",
      status: NETWORK === "mainnet-beta" ? "PASS" : "BLOCKED",
      detail: NETWORK,
    });
    const db = process.env.MAINNET_DATABASE_URL;
    checks.push({
      check: "Isolated mainnet database",
      status:
        db && new URL(db).pathname === "/oneonly_mainnet" ? "PASS" : "BLOCKED",
      detail: "Mainnet must use the separate oneonly_mainnet database",
    });
    checks.push({
      check: "Platform fee receiver",
      status: process.env.ONEONLY_FEE_WALLET ? "PASS" : "BLOCKED",
      detail:
        process.env.ONEONLY_FEE_WALLET ||
        "Owner public wallet address required",
    });
  }
  console.table(checks);
  if (checks.some((check) => check.status !== "PASS")) process.exitCode = 1;
}
main().catch(() => {
  console.error("Readiness check failed. Check the environment configuration.");
  process.exitCode = 1;
});
