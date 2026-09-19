"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { api, useLaunchpad } from "./provider";

type Profile = { username: string; avatar: string | null };
export function XAccountButton() {
  const app = useLaunchpad();
  const pathname = usePathname();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setProfile(null);
    if (app.wallet)
      api<{ wallet: string | null; profile: Profile | null }>("profile")
        .then((data) => {
          if (live && data.wallet === app.wallet) setProfile(data.profile);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [app.wallet]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("x");
    if (!result) return;
    app.setNotice(
      result === "linked"
        ? "X account linked. Your profile will appear in chats."
        : "X account wasn’t linked. Please try again.",
    );
    url.searchParams.delete("x");
    history.replaceState(null, "", url);
  }, [pathname]);
  async function connect() {
    setBusy(true);
    try {
      await app.authenticate();
      const tokenId =
        pathname.match(/^\/app\/token\/([0-9a-f-]{36})\/?$/)?.[1] ?? "";
      const result = await api<{ url: string }>("link-x", { tokenId });
      window.location.assign(result.url);
    } catch (error) {
      app.setNotice((error as Error).message);
      setBusy(false);
    }
  }
  const icon = (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.153h7.594l5.243 6.932 6.064-6.932Zm-1.29 19.49h2.039L6.486 3.24H4.298l13.313 17.403Z" />
    </svg>
  );
  if (profile)
    return (
      <a
        className="lp-x-account"
        href={`https://x.com/${profile.username}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`X profile @${profile.username}`}
        title={`@${profile.username} · Linked to your wallet`}
      >
        {profile.avatar ? (
          <img
            src={profile.avatar}
            alt=""
            width="24"
            height="24"
            referrerPolicy="no-referrer"
          />
        ) : (
          icon
        )}
        <span>@{profile.username}</span>
      </a>
    );
  return (
    <button
      type="button"
      className="lp-x-account"
      onClick={connect}
      disabled={busy}
      aria-label="Connect X account"
    >
      {busy ? <LoaderCircle size={16} className="lp-spin" /> : icon}
      <span>{busy ? "Connecting…" : "Connect X"}</span>
    </button>
  );
}
