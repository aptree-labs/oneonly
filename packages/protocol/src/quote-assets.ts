import { MAINNET_STOCKS } from "./mainnet-stocks";
import { MAINNET_TOKENS } from "./mainnet-tokens";
import { solanaNetwork } from "@oneonly/core";
import { PublicKey } from "@solana/web3.js";
export type QuoteAsset = {
  symbol: string;
  name: string;
  category: "SOL" | "USDC" | "Stocks" | "Tokens";
  mint: string;
  decimals: number;
  config: string | null;
  launchTokenType?: 0 | 1;
  referenceMint?: string;
  unavailableReason?: string;
};
export const USDC_MINTS = {
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "mainnet-beta": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
} as const;
export const QUOTE_MINTS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: USDC_MINTS[solanaNetwork(process.env.SOLANA_NETWORK)],
} as const;
/** Operator-controlled allowlist. A user's launch request can never choose an arbitrary mint or config. */
export function quoteAssets(
  env: NodeJS.ProcessEnv = process.env,
): QuoteAsset[] {
  const network = solanaNetwork(env.SOLANA_NETWORK);
  const defaults: QuoteAsset[] = [
    {
      symbol: "SOL",
      name: "Solana",
      category: "SOL",
      mint: QUOTE_MINTS.SOL,
      decimals: 9,
      config: env.DBC_CONFIG_SOL ?? null,
    },
    {
      symbol: "USDC",
      name: "USD Coin",
      category: "USDC",
      mint: USDC_MINTS[network],
      decimals: 6,
      config: env.DBC_CONFIG_USDC ?? null,
    },
  ];
  if (network === "mainnet-beta")
    defaults.push(
      ...MAINNET_TOKENS.map((asset) => ({
        symbol: asset.symbol,
        name: asset.name,
        mint: asset.mint,
        decimals: asset.decimals,
        category: "Tokens" as const,
        config: env[`DBC_CONFIG_${asset.symbol}`] ?? null,
        referenceMint: asset.mint,
      })),
      ...MAINNET_STOCKS.map((asset) => ({
        symbol: asset.symbol,
        name: asset.name,
        mint: asset.mint,
        decimals: asset.decimals,
        category: "Stocks" as const,
        config: env[`DBC_CONFIG_${asset.symbol}`] ?? null,
        referenceMint: asset.mint,
        unavailableReason:
          env.ONEONLY_STOCKS_ENABLED === "true"
            ? undefined
            : "Stock trading is awaiting release verification",
      })),
    );
  const custom: unknown = JSON.parse(env.ONEONLY_QUOTE_ASSETS || "[]");
  if (!Array.isArray(custom) || custom.length > 20)
    throw new Error("Quote asset allowlist must contain at most 20 assets.");
  const symbols = new Set(defaults.map((asset) => asset.symbol)),
    mints = new Set(defaults.map((asset) => asset.mint));
  for (const entry of custom) {
    if (
      !entry ||
      typeof entry !== "object" ||
      entry.network !== network ||
      typeof entry.symbol !== "string" ||
      !/^[A-Z][A-Z0-9]{0,11}$/.test(entry.symbol) ||
      symbols.has(entry.symbol) ||
      typeof entry.name !== "string" ||
      entry.name.length < 2 ||
      entry.name.length > 60 ||
      !["Stocks", "Tokens"].includes(entry.category) ||
      !Number.isInteger(entry.decimals) ||
      entry.decimals < 0 ||
      entry.decimals > 9
    )
      throw new Error("Invalid quote asset allowlist entry.");
    const mint = new PublicKey(entry.mint).toBase58();
    if (mints.has(mint)) throw new Error("Duplicate quote mint.");
    const config = entry.config ? new PublicKey(entry.config).toBase58() : null;
    const referenceMint = entry.referenceMint
      ? new PublicKey(entry.referenceMint).toBase58()
      : undefined;
    defaults.push({
      symbol: entry.symbol,
      name: entry.name,
      category: entry.category,
      mint,
      decimals: entry.decimals,
      config,
      referenceMint,
    });
    symbols.add(entry.symbol);
    mints.add(mint);
  }
  return defaults.map((asset) => {
    const replacement = env[`DBC_CONFIG_TOKEN2022_${asset.symbol}`];
    return {
      ...asset,
      config: replacement || asset.config,
      launchTokenType: replacement ? 1 : 0,
    };
  });
}
export function quoteAsset(symbol: string) {
  const asset = quoteAssets().find((asset) => asset.symbol === symbol);
  if (!asset)
    throw new Error("This quote asset is not enabled by the platform.");
  if (asset.unavailableReason) throw new Error(asset.unavailableReason);
  return asset;
}
