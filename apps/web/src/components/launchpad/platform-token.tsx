"use client";
import { BadgeCheck } from "lucide-react";
import { isOfficialPlatformToken } from "@oneonly/core";
import { useLaunchpad } from "./provider";

export function PlatformBadge({ mint }: { mint: string }) {
  const { network } = useLaunchpad();
  if (!isOfficialPlatformToken(mint, network)) return null;
  return (
    <BadgeCheck
      className="lp-platform-badge"
      size={22}
      role="img"
      aria-label="Official One Only token"
    >
      <title>Official One Only platform token</title>
    </BadgeCheck>
  );
}

export function PlatformBanner({ mint }: { mint: string }) {
  const { network } = useLaunchpad();
  if (!isOfficialPlatformToken(mint, network)) return null;
  // The mint's current metadata has an image, but no dedicated banner.
  return (
    <section
      className="lp-platform-banner"
      aria-label="Official One Only platform token"
    >
      <div>
        <span className="lp-kicker">THE ONE ONLY PLATFORM TOKEN</span>
        <h2>
          $ONEONLY <PlatformBadge mint={mint} />
        </h2>
        <p>One ticker. No copies.</p>
      </div>
      <img src="/brand/logo-256.webp" alt="One Only" width={128} height={128} />
    </section>
  );
}
