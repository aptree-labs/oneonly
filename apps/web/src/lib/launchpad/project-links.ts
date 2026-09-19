import { getDatabase, walletProfiles, eq } from "@oneonly/db";
import type { ProjectLinks } from "@oneonly/core";
import { fail } from "./auth";
import { safeXAvatar } from "../x-link";

export async function resolveProjectLinks(
  wallet: string,
  input: {
    website?: string;
    telegram?: string;
    discord?: string;
    xUrl?: string;
    xSource?: "link" | "connected";
  },
): Promise<ProjectLinks> {
  const links: ProjectLinks = {};
  for (const key of ["website", "telegram", "discord"] as const)
    if (input[key]) links[key] = input[key];
  if (input.xSource === "connected") {
    const [profile] = await (
      await getDatabase()
    )
      .select()
      .from(walletProfiles)
      .where(eq(walletProfiles.wallet, wallet))
      .limit(1);
    if (!profile)
      fail(
        "Connect an X account to this wallet first, or paste a profile link.",
      );
    const url = `https://x.com/${profile.xUsername}`;
    if (input.xUrl && input.xUrl.toLowerCase() !== url.toLowerCase())
      fail(
        "Your connected X profile changed. Select it again before launching.",
      );
    links.x = {
      url,
      username: profile.xUsername,
      verified: true,
      verifiedAt: new Date().toISOString(),
      avatar: safeXAvatar(profile.xAvatar),
    };
  } else if (input.xUrl) {
    links.x = {
      url: input.xUrl,
      username: new URL(input.xUrl).pathname.slice(1),
      verified: false,
    };
  }
  return links;
}
