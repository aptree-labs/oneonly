import { LaunchError } from "@oneonly/core";
import {
  getDatabase,
  traderLeaderboard,
  type LeaderboardPeriod,
} from "@oneonly/db";
import { NETWORK } from "@oneonly/protocol";
import { publicCache } from "../cache/public-cache";
import { publicPolicy } from "../cache/public-policy";

export async function loadLeaderboard(period: string) {
  if (!["24h", "7d", "all"].includes(period))
    throw new LaunchError({
      message: "Invalid leaderboard period.",
      status: 400,
    });
  return traderLeaderboard(
    await getDatabase(),
    NETWORK,
    period as LeaderboardPeriod,
    new Date(),
    !!process.env.X_LINK_SECRET,
  );
}
/** Shares the API cache for the server-rendered first view. */
export function initialLeaderboard() {
  const policy = publicPolicy(
    new Request("https://oneonly.lol/api/launchpad/leaderboard?period=24h"),
    ["leaderboard"],
  )!;
  return publicCache(policy.key, policy, () => loadLeaderboard("24h"));
}
