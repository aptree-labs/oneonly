import { Leaderboard } from "@/components/launchpad/leaderboard";
import { NETWORK } from "@oneonly/protocol";
import { creatorFeeEnvironmentEnabled } from "@/lib/deployment";
import { initialLeaderboard } from "@/lib/launchpad/leaderboard";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Leaderboard",
  description: "Top creators and traders on OneOnly.",
  alternates: { canonical: "https://oneonly.lol/app/leaderboard" },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const creatorsFirst =
    creatorFeeEnvironmentEnabled(NETWORK) && tab !== "traders";
  const initial = creatorsFirst
    ? undefined
    : await initialLeaderboard().catch(() => undefined);
  return (
    <Leaderboard
      initial={initial}
      initialTab={creatorsFirst ? "recipients" : "traders"}
    />
  );
}
