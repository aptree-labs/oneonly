import { client, PublicKey, PROGRAM } from "@oneonly/protocol";

import { historyConnection } from "./history-rpc";

type Pool = { id: string; pool: string; config: string };
/** Match Meteora's lifetime quote-fee split, retaining integer precision. */
export function curveFeeAmounts(state: any, config: any) {
  const share = BigInt(config.creatorTradingFeePercentage);
  if (share < 0n || share > 100n) throw new Error("Invalid creator fee share");
  const base = BigInt(state.metrics.totalTradingBaseFee.toString());
  if (base !== 0n) throw new Error("Base-collected fees need separate valuation");
  const total = BigInt(state.metrics.totalTradingQuoteFee.toString());
  const creator = total * share / 100n;
  const paid = creator - BigInt(state.creatorQuoteFee.toString());
  return { revenue: total - creator, creatorPayouts: paid > 0n ? paid : 0n };
}

/** Batch pool/config reads; publish a full snapshot or keep the previous cached one. */
export async function readCurveFeeSnapshot(pools: Pool[]) {
  const rpc = historyConnection(), coder = client().state.program.coder.accounts;
  const keys = [...new Set(pools.flatMap((pool) => [pool.pool, pool.config]))];
  const accounts = new Map<string, any>();
  for (let offset = 0; offset < keys.length; offset += 80) {
    const batch = keys.slice(offset, offset + 80);
    const values = await rpc.getMultipleAccountsInfo(batch.map((key) => new PublicKey(key)), "finalized");
    for (const [index, value] of values.entries()) {
      if (!value || !value.owner.equals(PROGRAM))
        throw new Error("A curve fee account is unavailable");
      let decoded: any;
      for (const name of ["virtualPool", "transferHookPool", "poolConfig", "configWithTransferHook"]) {
        try { decoded = coder.decode(name, value.data); break; } catch { /* Try the other supported account discriminator. */ }
      }
      if (!decoded) throw new Error("Unsupported curve fee account");
      accounts.set(batch[index], decoded);
    }
  }
  return pools.map((pool) => {
    const decoded = accounts.get(pool.pool), rawConfig = accounts.get(pool.config);
    const state = decoded?.poolState, config = rawConfig?.config ?? rawConfig;
    if (!state || state.config.toString() !== pool.config)
      throw new Error("Curve fee configuration mismatch");
    return { id: pool.id, ...curveFeeAmounts(state, config) };
  });
}
