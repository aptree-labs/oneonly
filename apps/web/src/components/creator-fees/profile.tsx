import { UserRound } from "lucide-react";
import type { FeeProfile } from "./client";
export function FeeIdentity({ profile }: { profile: FeeProfile }) {
  return (
    <span className="cf-identity">
      <span className="cf-avatar">
        <UserRound size={20} />
        {profile.avatar?.startsWith("https://") && (
          <img
            src={profile.avatar}
            alt=""
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        )}
      </span>
      <span>
        <strong>{profile.name || profile.username}</strong>
        <small>@{profile.username}</small>
      </span>
    </span>
  );
}
