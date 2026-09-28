"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { feeApi } from "./client";
import { FeeIdentity } from "./profile";
import { createCreatorHref } from "@/lib/create-prefill";
import type { creatorRankings, CreatorSort } from "@/lib/creator-fees/rankings";
import "./creator-fees.css";
type Rankings = Awaited<ReturnType<typeof creatorRankings>>;
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});
export function CreatorLeaderboard() {
  const [sort, setSort] = useState<CreatorSort>("fees");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Rankings | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setRevision((v) => v + 1);
    }, 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    feeApi<Rankings>(
      `leaderboard?sort=${sort}&offset=${offset}`,
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [sort, offset, revision]);
  return (
    <section aria-label="Creator leaderboard">
      <div className="lp-leaderboard-toolbar">
        <div
          className="lp-leaderboard-periods"
          role="group"
          aria-label="Rank creators by"
        >
          {(
            [
              ["fees", "Fees earned"],
              ["tokens", "Most tokens"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={sort === value}
              onClick={() => {
                setSort(value);
                setOffset(0);
                setData(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="lp-secondary"
          aria-label="Refresh creators"
          disabled={loading}
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw size={16} className={loading ? "lp-spin" : ""} />
        </button>
      </div>
      {error && (
        <p role="alert" className="lp-error">
          {error}
        </p>
      )}
      <div className="lp-panel" aria-busy={loading}>
        <div className="cf-section-heading">
          <h2>{sort === "fees" ? "Top earners" : "Most popular creators"}</h2>
          <span className="lp-caption">All time</span>
        </div>
        {!data?.creators.length && (
          <p role="status" className="lp-caption">
            {loading
              ? "Loading creators…"
              : error
                ? "Rankings unavailable."
                : "No creators yet."}
          </p>
        )}
        {data?.creators.map((row) => (
          <div className="cf-creator-result" key={row.xId}>
            <Link
              className="cf-recipient-row"
              href={`/app/creator-fees?recipient=${row.xId}`}
            >
              <span className="cf-creator-rank">#{row.rank}</span>
              <FeeIdentity profile={row} />
              <span className="cf-recipient-stat">
                <strong>
                  {sort === "fees"
                    ? row.feesUsd === null
                      ? "—"
                      : usd.format(row.feesUsd)
                    : `${row.tokenCount} ${row.tokenCount === 1 ? "token" : "tokens"}`}
                </strong>
                <small>
                  {sort === "fees"
                    ? `${row.tokenCount} linked ${row.tokenCount === 1 ? "token" : "tokens"}`
                    : `${row.feesUsd === null ? "—" : usd.format(row.feesUsd)} earned`}
                </small>
                {row.balances
                  ?.filter(
                    (balance) =>
                      BigInt(balance.amountAtomic) +
                        BigInt(balance.pendingAtomic) >
                      0n,
                  )
                  .map((balance) => (
                    <small
                      key={balance.mint}
                      title="Estimated unclaimed fees, including fees awaiting collection"
                    >
                      {(
                        Number(
                          BigInt(balance.amountAtomic) +
                            BigInt(balance.pendingAtomic),
                        ) /
                        10 ** balance.decimals
                      ).toLocaleString("en-US", {
                        maximumFractionDigits: Math.min(balance.decimals, 9),
                      })}{" "}
                      {balance.symbol} to claim
                    </small>
                  ))}
                {row.balances &&
                  row.observedTokens === row.tokenCount &&
                  row.balances.every(
                    (balance) =>
                      BigInt(balance.amountAtomic) +
                        BigInt(balance.pendingAtomic) ===
                      0n,
                  ) && <small>No unclaimed fees</small>}
                {(row.feesUsd === null || row.freshTokens < row.tokenCount) && (
                  <small>Fees updating</small>
                )}
              </span>
            </Link>
            <Link
              href={createCreatorHref(row.xId)!}
              className="cf-text-button cf-creator-launch"
            >
              Launch with @{row.username}
            </Link>
          </div>
        ))}
        {(offset > 0 || data?.hasMore) && (
          <nav className="cf-pagination" aria-label="Creator leaderboard pages">
            <button
              className="lp-secondary"
              disabled={!offset || loading}
              onClick={() => {
                setOffset((v) => Math.max(0, v - 24));
                setData(null);
              }}
            >
              Previous
            </button>
            <span>Page {offset / 24 + 1}</span>
            <button
              className="lp-secondary"
              disabled={!data?.hasMore || loading}
              onClick={() => {
                setOffset((v) => v + 24);
                setData(null);
              }}
            >
              Next
            </button>
          </nav>
        )}
      </div>
      <p className="lp-caption cf-ranking-note">
        Fees earned include claimed and unclaimed fees, estimated in USD at
        current prices. Most tokens counts confirmed launches sharing fees with
        each creator.
      </p>
    </section>
  );
}
