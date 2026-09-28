"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { feeApi, useFeeStatus } from "./client";
import { FeeIdentity } from "./profile";
import { earnedLabel } from "./earnings";
import { createCreatorHref } from "@/lib/create-prefill";
import type { feeRecipient } from "@/lib/creator-fees/service";
import "./creator-fees.css";
type Account = Awaited<ReturnType<typeof feeRecipient>>;
export function CreatorProfile({ id }: { id: string }) {
  const { status, error: statusError, staging } = useFeeStatus();
  const [data, setData] = useState<Account | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!status?.enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    feeApi<Account>(
      `recipients/${id}?offset=${offset}`,
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted)
          setData((previous) =>
            offset && previous
              ? {
                  ...result,
                  allocations: [
                    ...previous.allocations,
                    ...result.allocations.filter(
                      (row) =>
                        !previous.allocations.some(
                          (old) => old.tokenId === row.tokenId,
                        ),
                    ),
                  ],
                }
              : result,
          );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, offset, retry, status?.enabled]);
  return (
    <section className="cf-public-profile">
      <Link href="/app/leaderboard?tab=creators" className="lp-back">
        <ArrowLeft size={16} /> Creators
      </Link>
      <header className="cf-public-heading">
        <div>
          <span className="lp-kicker">CREATOR</span>
          <h1>{data ? `@${data.profile.username}` : "Creator"}</h1>
          {data && <FeeIdentity profile={data.profile} />}
        </div>
        {data && (
          <Link href={createCreatorHref(id)!} className="lp-primary">
            Launch with @{data.profile.username} <ArrowUpRight size={16} />
          </Link>
        )}
      </header>
      {(error || statusError) && (
        <p className="lp-error" role="alert">
          {error || statusError}{" "}
          <button
            type="button"
            className="cf-text-button"
            onClick={() =>
              statusError ? window.location.reload() : setRetry((v) => v + 1)
            }
          >
            Retry
          </button>
        </p>
      )}
      {(!staging || (status && !status.enabled)) && (
        <p className="lp-notice">Creator profiles are unavailable.</p>
      )}
      {staging &&
        !data &&
        loading &&
        !error &&
        !statusError &&
        (!status || status.enabled) && <p role="status">Loading creator…</p>}
      {data && (
        <div className="lp-panel">
          <div className="cf-section-heading">
            <h2>Tokens</h2>
            <span className="lp-caption">Total earned</span>
          </div>
          {!data.allocations.length && (
            <p className="lp-caption">No tokens yet.</p>
          )}
          {data.allocations.map((row) => (
            <Link
              className="cf-public-token"
              key={row.tokenId}
              href={`/app/token/${row.tokenId}`}
            >
              <span>
                <strong>${row.ticker}</strong>
                <small>{row.shareBps / 100}% creator share</small>
              </span>
              <strong>
                {row.balanceStatus === "available"
                  ? earnedLabel(row.balances)
                  : "—"}
              </strong>
              <ArrowUpRight size={16} />
            </Link>
          ))}
          {data.hasMore && (
            <button
              type="button"
              className="lp-secondary"
              disabled={loading}
              onClick={() => setOffset(data.allocations.length)}
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
