export type SolanaNetwork = "devnet" | "mainnet-beta";

export function solanaNetwork(
  value: string | undefined,
  environment?: string,
  stagingMainnetEnabled?: string,
): SolanaNetwork {
  if (
    environment === "staging" &&
    value !== "devnet" &&
    !(value === "mainnet-beta" && stagingMainnetEnabled === "true")
  )
    throw new Error(
      "Staging requires devnet, or explicit STAGING_MAINNET_ENABLED=true for mainnet-beta.",
    );
  if (value === undefined || value === "devnet") return "devnet";
  if (value === "mainnet-beta") return value;
  throw new Error("SOLANA_NETWORK must be devnet or mainnet-beta.");
}

export const GENESIS_HASHES = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
} as const;

export function walletChain(network: SolanaNetwork) {
  return network === "mainnet-beta" ? "solana:mainnet" : "solana:devnet";
}

export function explorerUrl(
  network: SolanaNetwork,
  kind: "tx" | "address",
  value: string,
) {
  return `https://explorer.solana.com/${kind}/${encodeURIComponent(value)}${network === "devnet" ? "?cluster=devnet" : ""}`;
}

export function publicRpc(network: SolanaNetwork) {
  return network === "mainnet-beta"
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com";
}

/** Preserve production key names; staging is isolated even on the same chain. */
export function deploymentScope(network: SolanaNetwork, environment?: string) {
  return environment === "staging" ? `staging-${network}` : network;
}
export function walletSessionCookieName(
  network: SolanaNetwork,
  environment?: string,
) {
  return `oneonly-wallet-${deploymentScope(network, environment)}`;
}
