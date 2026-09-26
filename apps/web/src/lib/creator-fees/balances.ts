import {
  getDatabase,
  creatorFeePools,
  launchTokens,
  eq,
  and,
} from "@oneonly/db";
import { connection, PublicKey, feeMarket } from "@oneonly/protocol";
import {
  allocationAddress,
  readAllocation,
  ledgerAddress,
  claimedAddress,
  xIdHash,
  decodeLedger,
  decodeClaimed,
} from "@oneonly/fee-escrow";
import { creatorFeeRuntime } from "./runtime";
export type CreatorFeeBalance = {
  mint: string;
  symbol: string;
  decimals: number;
  amountAtomic: string;
  claimedAtomic: string;
  totalEntitlementAtomic: string;
  pendingAtomic: string;
  pendingVenue: "dbc" | "damm-v2";
};
export async function readCreatorFeeBalances(
  tokenId: string,
  xId: string,
): Promise<CreatorFeeBalance[]> {
  const { program } = await creatorFeeRuntime(),
    db = await getDatabase();
  const [saved] = await db
    .select()
    .from(creatorFeePools)
    .where(
      and(
        eq(creatorFeePools.tokenId, tokenId),
        eq(creatorFeePools.network, "devnet"),
      ),
    )
    .limit(1);
  const [token] = await db
    .select()
    .from(launchTokens)
    .where(
      and(eq(launchTokens.id, tokenId), eq(launchTokens.network, "devnet")),
    )
    .limit(1);
  if (!saved || !token || saved.program !== program.toBase58())
    throw new Error("Fee allocation unavailable");
  const pool = new PublicKey(saved.pool),
    allocation = allocationAddress(pool, program),
    hash = xIdHash(xId);
  const state = await readAllocation(connection(), pool, program),
    share = state.shares.find((s) => s.xIdHash.equals(hash));
  if (
    !share ||
    saved.escrow !== allocation.toBase58() ||
    !state.pool.equals(pool) ||
    !state.baseMint.equals(new PublicKey(token.mint))
  )
    throw new Error("Fee recipient not verified");
  const market = await feeMarket(saved.pool, program);
  if (!state.quoteMint.equals(market.config.quoteMint))
    throw new Error("Fee quote mint mismatch");
  const mints = [state.baseMint, state.quoteMint];
  const ledgers = mints.map((m) => ledgerAddress(allocation, m, program));
  const accounts = await connection().getMultipleAccountsInfo(
    [...ledgers, ...ledgers.map((l) => claimedAddress(l, hash, program))],
    "confirmed",
  );
  return mints.map((mint, i) => {
    const ledger = accounts[i] ? decodeLedger(accounts[i]!, program) : null;
    if (
      ledger &&
      (!ledger.allocation.equals(allocation) || !ledger.mint.equals(mint))
    )
      throw new Error("Invalid fee ledger");
    const total = ledger?.totalReceived ?? 0n,
      claimed = accounts[i + 2] ? decodeClaimed(accounts[i + 2]!, program) : 0n;
    const entitlement = (total * BigInt(share.shareBps)) / 10000n;
    if (claimed > entitlement) throw new Error("Invalid fee accounting");
    const dbc = i === 0 ? market.pendingDbc.base : market.pendingDbc.quote,
      damm = i === 0 ? market.pendingDamm.base : market.pendingDamm.quote;
    const pending =
      ((total + dbc + damm) * BigInt(share.shareBps)) / 10000n - entitlement;
    return {
      mint: mint.toBase58(),
      symbol: i === 0 ? token.ticker : token.quote,
      decimals: i === 0 ? 6 : (token.quoteDecimals ?? 9),
      amountAtomic: (entitlement - claimed).toString(),
      claimedAtomic: claimed.toString(),
      totalEntitlementAtomic: entitlement.toString(),
      pendingAtomic: pending.toString(),
      pendingVenue: dbc > 0n ? "dbc" : "damm-v2",
    };
  });
}
