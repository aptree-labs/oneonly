import { solanaNetwork } from "@oneonly/core";
type DatabaseEnvironment = Record<string, string | undefined>;

/** Staging never reads the production connection variable, even on mainnet. */
export function assertStagingDatabase(env: DatabaseEnvironment) {
  if (env.ONEONLY_ENVIRONMENT !== "staging") return;
  try {
    const network = solanaNetwork(
      env.SOLANA_NETWORK,
      env.ONEONLY_ENVIRONMENT,
      env.STAGING_MAINNET_ENABLED,
    );
    if (env.MAINNET_DATABASE_URL || !env.DATABASE_URL) throw new Error();
    const url = new URL(env.DATABASE_URL);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.searchParams.has("database") ||
      url.searchParams.has("dbname")
    )
      throw new Error();
    if (network === "mainnet-beta") {
      if (url.pathname !== "/oneonly_staging_mainnet") throw new Error();
    } else if (
      ["/oneonly_mainnet", "/oneonly_staging_mainnet"].includes(
        decodeURIComponent(url.pathname),
      )
    )
      throw new Error();
  } catch {
    throw new Error(
      "Staging requires an isolated DATABASE_URL, no MAINNET_DATABASE_URL, and an explicit mainnet opt-in with database oneonly_staging_mainnet for real-fund tests.",
    );
  }
}

export function selectedDatabaseUrl(env: DatabaseEnvironment) {
  assertStagingDatabase(env);
  if (env.ONEONLY_ENVIRONMENT === "staging") return env.DATABASE_URL;
  if (env.SOLANA_NETWORK === "mainnet-beta") {
    const value = env.MAINNET_DATABASE_URL;
    if (!value || new URL(value).pathname !== "/oneonly_mainnet")
      throw new Error(
        "Mainnet requires the isolated oneonly_mainnet database.",
      );
    return value;
  }
  return env.DATABASE_URL;
}

/** Neon serverless traffic uses transaction pooling; migrations keep their explicit direct URL. */

export function runtimeDatabaseUrl(value: string) {
  const url = new URL(value);
  if (
    url.hostname.endsWith(".neon.tech") &&
    !url.hostname.split(".")[0].endsWith("-pooler")
  ) {
    const [endpoint, ...domain] = url.hostname.split(".");
    url.hostname = [endpoint + "-pooler", ...domain].join(".");
  }
  return url.toString();
}
