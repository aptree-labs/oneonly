"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Building2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { UsdValue } from "./usd-value";
import NumberFlow from "@number-flow/react";
import { api, number } from "./provider";
import type { officeTotals } from "@oneonly/db";
import type { OfficeFees } from "@/lib/launchpad/office";

type Totals = Omit<Awaited<ReturnType<typeof officeTotals>>, "pools">;
export function Office() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [fees, setFees] = useState<OfficeFees | null>(null);
  const [loading, setLoading] = useState(true);
  const [feeLoading, setFeeLoading] = useState(true);
  const [error, setError] = useState("");
  const [feeError, setFeeError] = useState("");
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true,
      totalsPending = false,
      feesPending = false;
    const loadTotals = () => {
      if (totalsPending) return;
      totalsPending = true;
      setLoading(true);
      setError("");
      void api<Totals>("office")
        .then((data) => {
          if (active) setTotals(data);
        })
        .catch(() => {
          if (active) setError("Totals couldn’t load. Try refreshing.");
        })
        .finally(() => {
          totalsPending = false;
          if (active) setLoading(false);
        });
    };
    const loadFees = () => {
      if (feesPending) return;
      feesPending = true;
      setFeeLoading(true);
      setFeeError("");
      void api<OfficeFees>("office-fees")
        .then((data) => {
          if (active) setFees(data);
        })
        .catch(() => {
          if (active) setFeeError("Fee totals are temporarily unavailable.");
        })
        .finally(() => {
          feesPending = false;
          if (active) setFeeLoading(false);
        });
    };
    const refresh = () => {
      loadTotals();
      loadFees();
    };
    refreshRef.current = refresh;
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") loadTotals();
    }, 15_000);
    const feeTimer = setInterval(() => {
      if (document.visibilityState === "visible") loadFees();
    }, 60_000);
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      refreshRef.current = () => {};
      clearInterval(timer);
      clearInterval(feeTimer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  const partialFees =
    !!fees &&
    (fees.checked < fees.pools ||
      fees.graduated > 0 ||
      fees.usd?.complete === false);
  function amounts(key: "revenue" | "creatorPayouts") {
    if (!fees)
      return (
        <span className="lp-office-placeholder">
          {feeLoading ? "Loading…" : "Unavailable"}
        </span>
      );
    return (
      <UsdValue
        value={fees.checked === 0 && fees.pools > 0 ? null : fees.usd?.[key]}
      />
    );
  }
  return (
    <section className="lp-office">
      <header className="lp-office-heading">
        <div>
          <span className="lp-kicker">ONE ONLY · ALL TIME</span>
          <h1>
            Retard <em>Office.</em>
          </h1>
          <p>The numbers behind the chaos.</p>
        </div>
        <button
          className="lp-secondary"
          onClick={() => refreshRef.current()}
          disabled={loading || feeLoading}
          aria-label="Refresh office totals"
        >
          <RefreshCw
            size={16}
            className={loading || feeLoading ? "lp-spin" : ""}
          />
          <span>Refresh</span>
        </button>
      </header>
      {error && (
        <p className="lp-error" role="alert">
          {error}
        </p>
      )}
      {feeError && (
        <p className="lp-error" role="alert">
          {feeError}
        </p>
      )}
      <div className="lp-office-money" aria-busy={loading}>
        <article className="lp-panel lp-office-volume">
          <span className="lp-kicker">All-time volume</span>
          <div className="lp-office-value">
            {totals ? (
              totals.volumeUsd === null ? (
                "Unpriced"
              ) : (
                <NumberFlow
                  value={totals.volumeUsd}
                  locales="en-US"
                  format={{
                    style: "currency",
                    currency: "USD",
                    notation: "compact",
                    maximumFractionDigits: 2,
                  }}
                />
              )
            ) : (
              <span className="lp-office-placeholder">
                {loading ? "Loading…" : "Unavailable"}
              </span>
            )}
          </div>
          <p>
            {totals
              ? `${number(totals.trades)} indexed trades${totals.volumeComplete ? "" : " · Partial history"}`
              : "Reading trading activity"}
          </p>
        </article>
        <article className="lp-panel">
          <span className="lp-kicker">All-time revenue</span>
          <div className="lp-office-value" aria-busy={feeLoading}>
            {amounts("revenue")}
          </div>
          <p>Curve fees · Current USD value{partialFees ? " · Partial" : ""}</p>
        </article>
        <article className="lp-panel">
          <span className="lp-kicker">All-time creator payouts</span>
          <div className="lp-office-value" aria-busy={feeLoading}>
            {amounts("creatorPayouts")}
          </div>
          <p>
            Claimed fees · Current USD value{partialFees ? " · Partial" : ""}
          </p>
        </article>
      </div>
      <div className="lp-office-counts lp-panel">
        <div>
          <span className="lp-kicker">All-time launches</span>
          <strong>
            {totals ? (
              <NumberFlow value={totals.launches} locales="en-US" />
            ) : (
              "—"
            )}
          </strong>
          <Link href="/app">
            Explore tokens <ArrowUpRight size={15} />
          </Link>
        </div>
        <div>
          <span className="lp-kicker">All-time graduations</span>
          <strong>
            {totals ? (
              <NumberFlow value={totals.graduations} locales="en-US" />
            ) : (
              "—"
            )}
          </strong>
          <p>Migrated to Meteora{totals?.uncheckedPools ? " · Partial" : ""}</p>
        </div>
        <Building2 className="lp-office-stamp" aria-hidden="true" />
      </div>
      {totals && (
        <section className="lp-panel lp-office-ledger">
          <div className="lp-section-heading">
            <h2>By paired asset</h2>
            <span>Indexed volume</span>
          </div>
          {totals.volumes.length ? (
            <div className="lp-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Volume</th>
                    <th>Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.volumes.map((asset) => (
                    <tr key={asset.mint ?? asset.symbol}>
                      <th scope="row">{asset.symbol}</th>
                      <td title={asset.amount}>{number(asset.amount)}</td>
                      <td>{number(asset.trades)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No indexed trades yet.</p>
          )}
        </section>
      )}
      <details className="lp-office-notes">
        <summary>About these totals</summary>
        <p>
          Launches include released tickers. Graduations count completed
          migrations, not curves waiting to graduate.
        </p>
        <p>
          USD volume uses prices recorded for each trade. Missing prices and
          unindexed history are excluded.
          {totals
            ? ` Full history is current for ${totals.coveredPools} of ${totals.launches} pools; ${totals.unpricedTrades} trades have no USD price.`
            : ""}
        </p>
        <p>
          Revenue is the platform’s curve trading fee share, including unclaimed
          earnings. Creator payouts use Meteora’s lifetime fee share minus
          unclaimed fees; per-trade rounding can cause small differences. Fees
          after graduation and migration fees are not included.
          {fees ? ` Read ${fees.checked} of ${fees.pools} pools.` : ""}
        </p>
        <p>
          Revenue and payouts are valued at current USD prices, not prices when
          earned or claimed. Unpriced assets are excluded from partial totals.
          The volume breakdown uses native, unscaled units.
        </p>
      </details>
      {totals?.latestTradeAt && (
        <p className="lp-office-updated">
          Latest indexed trade{" "}
          {new Date(totals.latestTradeAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </p>
      )}
      {totals && (
        <p className="lp-office-updated">
          Updated{" "}
          {new Date(totals.asOf).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {loading || feeLoading
            ? " · Refreshing…"
            : " · Volume refreshes every 15 seconds"}
        </p>
      )}
    </section>
  );
}
