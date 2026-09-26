/** Neon serverless traffic uses transaction pooling; migrations keep their explicit direct URL. */
export function assertStagingDatabase(env: Record<string, string | undefined>) {
  if (env.ONEONLY_ENVIRONMENT !== "staging") return;
  if (
    env.SOLANA_NETWORK !== "devnet" ||
    env.MAINNET_DATABASE_URL ||
    !env.DATABASE_URL ||
    new URL(env.DATABASE_URL).pathname === "/oneonly_mainnet"
  )
    throw new Error(
      "Staging requires devnet and an isolated DATABASE_URL without MAINNET_DATABASE_URL.",
    );
}

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
