import { Leaderboard } from "@/components/launchpad/leaderboard";
import { initialLeaderboard } from "@/lib/launchpad/leaderboard";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Trader leaderboard",
  description:
    "Top traders across OneOnly tokens, ranked by indexed trading volume.",
  alternates: { canonical: "https://oneonly.lol/app/leaderboard" },
};
export default async function Page() {
  const initial = await initialLeaderboard().catch(() => undefined);
  return <Leaderboard initial={initial} />;
}
