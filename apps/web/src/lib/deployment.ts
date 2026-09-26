type DeploymentEnvironment = Record<string, string | undefined>;

export function isStaging(env: DeploymentEnvironment = process.env) {
  return env.ONEONLY_ENVIRONMENT === "staging";
}

/** Fail the build instead of allowing a demo deployment to spend real funds. */
export function assertStagingEnvironment(
  env: DeploymentEnvironment = process.env,
) {
  if (!isStaging(env)) return;
  if (env.SOLANA_NETWORK !== "devnet")
    throw new Error("Staging requires SOLANA_NETWORK=devnet.");
  const launchpad = new URL(env.LAUNCHPAD_URL || "http://localhost:3000");
  const oauth = new URL(env.APP_URL || "http://localhost:3000");
  if (
    launchpad.origin !== "https://staging.oneonly.lol" ||
    oauth.origin !== launchpad.origin
  )
    throw new Error(
      "Staging APP_URL and LAUNCHPAD_URL must both use https://staging.oneonly.lol.",
    );
  if (
    env.MAINNET_DATABASE_URL ||
    (env.DATABASE_URL &&
      new URL(env.DATABASE_URL).pathname === "/oneonly_mainnet")
  )
    throw new Error(
      "Staging must use its own devnet database, without MAINNET_DATABASE_URL.",
    );
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
