export type SolanaNetwork = "devnet" | "mainnet-beta";

export function solanaNetwork(
  value: string | undefined,
  environment?: string,
): SolanaNetwork {
  if (environment === "staging" && value !== "devnet")
    throw new Error("Staging requires SOLANA_NETWORK=devnet.");
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
