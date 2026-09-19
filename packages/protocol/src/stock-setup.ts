import { createHash } from "node:crypto";
import { Connection, PublicKey, type AccountInfo } from "@solana/web3.js";
import {
  unpackMint,
  TOKEN_2022_PROGRAM_ID,
  getExtensionTypes,
  ExtensionType,
  getPausableConfig,
  getDefaultAccountState,
  AccountState,
  getTransferHook,
  getScaledUiAmountConfig,
} from "@solana/spl-token";
import {
  deriveTokenBadgeAddress,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  deriveTokenBadgeAddress as deriveDammBadge,
  CP_AMM_PROGRAM_ID,
} from "@meteora-ag/cp-amm-sdk";
import { MAINNET_STOCKS } from "./mainnet-stocks";

const badgeDiscriminator = createHash("sha256")
  .update("account:TokenBadge")
  .digest()
  .subarray(0, 8);
export function verifyStockBadge(
  account: AccountInfo<Buffer> | null,
  program: PublicKey,
  mint: PublicKey,
) {
  if (
    !account ||
    !account.owner.equals(program) ||
    !account.data.subarray(0, 8).equals(badgeDiscriminator) ||
    !account.data.subarray(8, 40).equals(mint.toBuffer())
  )
    throw new Error(
      "The stock's Meteora token approval could not be verified.",
    );
}

/** Only permits owner configuration preparation. This does not enable stock trading. */
export async function inspectStockSetup(rpc: Connection, symbol: string) {
  const stock = MAINNET_STOCKS.find((asset) => asset.symbol === symbol);
  if (!stock) throw new Error("Unsupported stock setup.");
  const mint = new PublicKey(stock.mint),
    badge = deriveTokenBadgeAddress(mint),
    dammBadge = deriveDammBadge(mint);
  if (badge.toBase58() !== stock.badge)
    throw new Error("Stock badge address mismatch.");
  const [account, dbcAccount, dammAccount] = await rpc.getMultipleAccountsInfo([
    mint,
    badge,
    dammBadge,
  ]);
  verifyStockBadge(dbcAccount, DYNAMIC_BONDING_CURVE_PROGRAM_ID, mint);
  verifyStockBadge(dammAccount, CP_AMM_PROGRAM_ID, mint);
  const info = unpackMint(mint, account, TOKEN_2022_PROGRAM_ID);
  if (!info.isInitialized || info.decimals !== stock.decimals)
    throw new Error("Stock mint decimals changed.");
  const supported = new Set([
    ExtensionType.MetadataPointer,
    ExtensionType.PermanentDelegate,
    ExtensionType.DefaultAccountState,
    ExtensionType.ScaledUiAmountConfig,
    ExtensionType.PausableConfig,
    ExtensionType.ConfidentialTransferMint,
    ExtensionType.TransferHook,
    ExtensionType.TokenMetadata,
  ]);
  if (getExtensionTypes(info.tlvData).some((type) => !supported.has(type)))
    throw new Error("This stock has an unreviewed token extension.");
  if (
    getPausableConfig(info)?.paused ||
    getDefaultAccountState(info)?.state === AccountState.Frozen
  )
    throw new Error("The issuer has paused or frozen this stock.");
  const hook = getTransferHook(info);
  if (hook && !hook.programId.equals(PublicKey.default))
    throw new Error(
      "This stock now has an active transfer hook; setup requires a new review.",
    );
  const scale = getScaledUiAmountConfig(info);
  if (!scale) throw new Error("Stock scaling information is missing.");
  const multiplier =
    BigInt(Math.floor(Date.now() / 1000)) >=
    scale.newMultiplierEffectiveTimestamp
      ? scale.newMultiplier
      : scale.multiplier;
  if (!Number.isFinite(multiplier) || multiplier <= 0)
    throw new Error("Invalid stock scaling multiplier.");
  return { stock, badge, dammBadge, multiplier, info };
}
