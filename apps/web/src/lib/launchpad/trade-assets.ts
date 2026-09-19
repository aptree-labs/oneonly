import {
  connection,
  quoteAssets,
  quoteMultiplier,
  NETWORK,
  PublicKey,
} from "@oneonly/protocol";
import { formatScaledUnits, formatUnits } from "@oneonly/core";
import { displayReferences } from "./discovery";
import { walletAddress, rateLimit } from "./auth";

export async function tradeAssets(
  token: { mint: string; quote: string },
  address: string | null,
) {
  const assets = quoteAssets().filter(
    (asset) =>
      !asset.unavailableReason &&
      (NETWORK === "mainnet-beta" || asset.symbol === token.quote),
  );
  const referencesPromise = displayReferences();
  const wallet = address ? walletAddress(address) : null;
  let sol: bigint | null = null;
  const balances = new Map<string, bigint>();
  if (wallet) {
    await rateLimit(`trade-balances:${wallet}`, 15);
    const rpc = connection(),
      owner = new PublicKey(wallet);
    const [native, classic, extended] = await Promise.all([
      rpc.getBalance(owner),
      rpc.getParsedTokenAccountsByOwner(owner, {
        programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      }),
      rpc.getParsedTokenAccountsByOwner(owner, {
        programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
      }),
    ]);
    sol = BigInt(native);
    for (const account of [...classic.value, ...extended.value]) {
      const info = account.account.data.parsed.info;
      balances.set(
        info.mint,
        (balances.get(info.mint) ?? 0n) + BigInt(info.tokenAmount.amount),
      );
    }
  }
  const references = await referencesPromise;
  return {
    wallet,
    tokenBalance: wallet
      ? formatUnits(balances.get(token.mint) ?? 0n, 6)
      : null,
    assets: await Promise.all(
      assets.map(async (asset) => {
        const raw =
          asset.symbol === "SOL"
            ? sol
            : wallet
              ? (balances.get(asset.mint) ?? 0n)
              : null;
        let balance: string | null = null;
        if (raw !== null) {
          try {
            balance = formatScaledUnits(
              raw,
              asset.decimals,
              raw === 0n ? 1 : await quoteMultiplier(asset.symbol),
            );
          } catch {
            /* Unknown issuer scale must not appear as a zero balance. */
          }
        }
        const multiplier = await quoteMultiplier(asset.symbol).catch(
          () => null,
        );
        const usd =
          multiplier && references?.[asset.symbol]
            ? references[asset.symbol] / multiplier
            : null;
        return {
          usd,
          symbol: asset.symbol,
          name: asset.name,
          mint: asset.mint,
          category: asset.category,
          decimals: asset.decimals,
          balance,
        };
      }),
    ),
  };
}
