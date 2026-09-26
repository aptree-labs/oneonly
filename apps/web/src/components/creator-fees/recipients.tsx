"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { feeApi, useFeeStatus, type FeeProfile } from "./client";
import { FeeIdentity } from "./profile";
import "./creator-fees.css";
type Recipient = FeeProfile & {
  tokenCount: number;
  balanceStatus: string;
  balances: {
    mint: string;
    symbol: string;
    decimals: number;
    amountAtomic: string;
    pendingAtomic: string;
  }[];
  lastUpdated?: string | null;
  coverage?: { observed: number; fresh: number; total: number };
};
export function RecipientList({
  query = "",
  compact = false,
  onChoose,
}: {
  query?: string;
  compact?: boolean;
  onChoose?: () => void;
}) {
  const { status, devnet, error: statusError } = useFeeStatus();
  const [rows, setRows] = useState<Recipient[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setOffset(0);
    setRows([]);
  }, [query]);
  useEffect(() => {
    if (!status?.enabled || (compact && !query.trim())) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () => {
        feeApi<{ recipients: Recipient[]; hasMore: boolean }>(
          `recipients?query=${encodeURIComponent(query.trim())}&offset=${offset}`,
          undefined,
          controller.signal,
        )
          .then((result) => {
            setRows(result.recipients);
            setHasMore(result.hasMore);
          })
          .catch((error) => {
            if (!controller.signal.aborted) setError(error.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      compact ? 300 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [status?.enabled, query, offset, compact, retry]);
  if (!devnet || (compact && !query.trim())) return null;
  if (!status?.enabled)
    return compact ? null : (
      <p className="lp-notice" role="status">
        {statusError ||
          (status
            ? "Fee recipients are not available in this environment."
            : "Loading fee recipients…")}
      </p>
    );
  return (
    <section
      className={`cf-recipients ${compact ? "cf-recipients-compact" : "lp-panel"}`}
      aria-busy={loading}
      aria-label="Fee recipients"
    >
      <div className="cf-section-heading">
        <h2>Fee recipients</h2>
        {!compact && (
          <Link href="/app/creator-fees" className="lp-secondary">
            My creator fees <ArrowUpRight size={16} />
          </Link>
        )}
      </div>
      {loading && (
        <p className="cf-muted" role="status">
          <LoaderCircle size={16} className="lp-spin" /> Finding recipients…
        </p>
      )}
      {error && (
        <p className="lp-error" role="alert">
          {error}{" "}
          <button
            type="button"
            className="cf-text-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {!loading && !error && rows.length === 0 && (
        <p className="lp-caption">
          {query
            ? "No matching fee recipients."
            : "No X accounts have fee allocations yet."}
        </p>
      )}
      {!loading &&
        !error &&
        (compact ? rows.slice(0, 4) : rows).map((row) => (
          <Link
            className="cf-recipient-row"
            key={row.xId}
            href={`/app/creator-fees?recipient=${encodeURIComponent(row.xId)}`}
            onClick={onChoose}
          >
            <FeeIdentity profile={row} />
            <span className="cf-recipient-stat">
              <strong>
                {row.tokenCount} {row.tokenCount === 1 ? "token" : "tokens"}
              </strong>
              {!compact && <RecipientFees row={row} />}
            </span>
            <ArrowUpRight size={16} />
          </Link>
        ))}
      {!compact && (offset > 0 || hasMore) && (
        <nav className="cf-pagination" aria-label="Fee recipient pages">
          <button
            className="lp-secondary"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - 24))}
          >
            Previous
          </button>
          <button
            className="lp-secondary"
            disabled={!hasMore || loading}
            onClick={() => setOffset(offset + 24)}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}

function RecipientFees({ row }: { row: Recipient }) {
  if (row.balanceStatus === "unavailable")
    return <small>Unclaimed fees unavailable</small>;
  const labels = row.balances.map((balance) => {
    const amount =
      Number(
        BigInt(balance.amountAtomic) + BigInt(balance.pendingAtomic || "0"),
      ) /
      10 ** balance.decimals;
    return `${amount.toLocaleString("en-US", { maximumFractionDigits: Math.min(balance.decimals, 9) })} ${balance.symbol}`;
  });
  return (
    <>
      <small title={labels.join(" · ")}>
        {labels.slice(0, 2).join(" · ") ||
          (row.balanceStatus === "partial"
            ? "Fees updating"
            : "No unclaimed fees")}
        {labels.length > 2 ? ` +${labels.length - 2} assets` : ""}
      </small>
      <small
        title={
          row.lastUpdated
            ? `Observed ${new Date(row.lastUpdated).toLocaleString()}`
            : undefined
        }
      >
        {row.balanceStatus === "partial"
          ? "Last known · partial"
          : "Unclaimed · estimated"}
      </small>
    </>
  );
}
