type DeploymentEnvironment = Record<string, string | undefined>;

export function isStaging(env: DeploymentEnvironment = process.env) {
  return env.ONEONLY_ENVIRONMENT === "staging";
}

/** Explicit production rollout, with staging's independent mainnet opt-in. */
export function creatorFeeEnvironmentEnabled(
  network: string,
  env: DeploymentEnvironment = process.env,
) {
  if (isStaging(env))
    return (
      network === "devnet" ||
      (network === "mainnet-beta" && env.STAGING_MAINNET_ENABLED === "true")
    );
  return (
    env.ONEONLY_ENVIRONMENT === "production" &&
    network === "mainnet-beta" &&
    env.CREATOR_FEES_ENABLED === "true"
  );
}

/** Real-fund staging requires deliberate opt-in and separate storage. */
export function assertStagingEnvironment(
  env: DeploymentEnvironment = process.env,
) {
  if (!isStaging(env)) return;
  if (
    env.SOLANA_NETWORK !== "devnet" &&
    !(
      env.SOLANA_NETWORK === "mainnet-beta" &&
      env.STAGING_MAINNET_ENABLED === "true"
    )
  )
    throw new Error(
      "Staging requires devnet, or explicit STAGING_MAINNET_ENABLED=true for mainnet-beta.",
    );
  const launchpad = new URL(env.LAUNCHPAD_URL || "http://localhost:3000");
  const oauth = new URL(env.APP_URL || "http://localhost:3000");
  if (
    launchpad.origin !== "https://staging.oneonly.lol" ||
    oauth.origin !== launchpad.origin
  )
    throw new Error(
      "Staging APP_URL and LAUNCHPAD_URL must both use https://staging.oneonly.lol.",
    );
  try {
    if (env.MAINNET_DATABASE_URL || !env.DATABASE_URL) throw new Error();
    const database = new URL(env.DATABASE_URL);
    if (
      !["postgres:", "postgresql:"].includes(database.protocol) ||
      database.searchParams.has("database") ||
      database.searchParams.has("dbname")
    )
      throw new Error();
    if (env.SOLANA_NETWORK === "mainnet-beta") {
      if (database.pathname !== "/oneonly_staging_mainnet") throw new Error();
    } else if (
      ["/oneonly_mainnet", "/oneonly_staging_mainnet"].includes(
        decodeURIComponent(database.pathname),
      )
    )
      throw new Error();
  } catch {
    throw new Error(
      "Staging must use its own database without MAINNET_DATABASE_URL; mainnet staging requires oneonly_staging_mainnet.",
    );
  }
}

/** Production keeps its existing broker/callback for active OAuth sessions. */
export function xLinkStartOrigin(env: DeploymentEnvironment = process.env) {
  return isStaging(env) ? "https://staging.oneonly.lol" : "https://oneonly.lol";
}

export function xLinkReturnOrigin(env: DeploymentEnvironment = process.env) {
  return isStaging(env)
    ? "https://staging.oneonly.lol"
    : "https://app.oneonly.lol";
}
