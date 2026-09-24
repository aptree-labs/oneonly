"use client";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
  Trophy,
  UserRound,
} from "lucide-react";
import NumberFlow from "@number-flow/react";
import type { LeaderboardPeriod, TraderLeaderboard } from "@oneonly/db";
import { api, short, useLaunchpad } from "./provider";

const periods = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "all", label: "All time" },
] as const;
export function Leaderboard({ initial }: { initial?: TraderLeaderboard }) {
  const { wallet, network } = useLaunchpad();
  const [period, setPeriod] = useState<LeaderboardPeriod>("24h");
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [copied, setCopied] = useState("");
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true,
      pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      setLoading(true);
      try {
        const result = await api<TraderLeaderboard>(
          `leaderboard?period=${period}`,
        );
        if (active) {
          setData(result);
          setError("");
        }
      } catch {
        if (active) setError("Rankings couldn’t refresh. Try again.");
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    }
    refresh.current = load;
    void load();
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(visible, 30_000);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [period]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(""), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  const current = data?.period === period ? data : undefined;
  const pages = Math.max(1, Math.ceil((current?.traders.length ?? 0) / 25));
  const activePage = Math.min(page, pages - 1);
  const mine = wallet
    ? current?.traders.find((row) => row.wallet === wallet)
    : null;
  async function copy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(address);
    } catch {
      setError("Couldn’t copy the address. Open the wallet link to copy it.");
    }
  }
  return (
    <section className="lp-leaderboard">
      <header className="lp-office-heading">
        <div>
          <span className="lp-kicker">ONE ONLY · TOP TRADERS</span>
          <h1>
            The <em>Leaderboard.</em>
          </h1>
          <p>Big moves. On the record.</p>
        </div>
        <Trophy
          className="lp-leaderboard-trophy"
          size={52}
          aria-hidden="true"
        />
      </header>
      <div className="lp-leaderboard-toolbar">
        <div
          className="lp-leaderboard-periods"
          role="group"
          aria-label="Ranking period"
        >
          {periods.map((option) => (
            <button
              type="button"
              key={option.value}
              aria-pressed={period === option.value}
              onClick={() => {
                setPeriod(option.value);
                setPage(0);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          className="lp-secondary"
          type="button"
          aria-label="Refresh leaderboard"
          disabled={loading}
          onClick={() => refresh.current()}
        >
          <RefreshCw size={16} className={loading ? "lp-spin" : ""} />
        </button>
      </div>
      {mine && (
        <p className="lp-leaderboard-position">
          Your rank <strong>#{mine.rank}</strong>
          <span>by trading volume</span>
        </p>
      )}
      {error && (
        <p className="lp-error" role="alert">
          {error}
        </p>
      )}
      <section className="lp-panel lp-leaderboard-board" aria-busy={loading}>
        <div className="lp-leaderboard-caption">
          <h2>By trading volume</h2>
          <span>
            {current
              ? `${current.totalTraders.toLocaleString("en-US")} traders · Top 100`
              : "Loading rankings…"}
          </span>
        </div>
        <div className="lp-table-scroll">
          <table className="lp-leaderboard-table">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Trader</th>
                <th scope="col">Volume · USD</th>
                <th scope="col" className="lp-leaderboard-extra">
                  Trades
                </th>
                <th scope="col" className="lp-leaderboard-extra">
                  Tokens
                </th>
              </tr>
            </thead>
            <tbody>
              {current?.traders
                .slice(activePage * 25, (activePage + 1) * 25)
                .map((trader) => (
                  <tr
                    key={trader.wallet}
                    className={
                      trader.wallet === wallet
                        ? "lp-leaderboard-mine"
                        : trader.rank === 1
                          ? "lp-leaderboard-first"
                          : undefined
                    }
                  >
                    <td>
                      <span className="lp-leaderboard-rank">
                        {trader.rank === 1 ? (
                          <Trophy size={16} aria-hidden="true" />
                        ) : null}
                        {trader.rank}
                      </span>
                    </td>
                    <th scope="row">
                      <div className="lp-leaderboard-trader">
                        <span className="lp-leaderboard-avatar">
                          <UserRound size={18} />
                          {trader.profile?.avatar &&
                            /^https:\/\//.test(trader.profile.avatar) && (
                              <img
                                src={trader.profile.avatar}
                                alt=""
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                onError={(event) => {
                                  event.currentTarget.style.display = "none";
                                }}
                              />
                            )}
                        </span>
                        <div className="lp-leaderboard-identity">
                          <a
                            href={
                              trader.profile
                                ? `https://x.com/${encodeURIComponent(trader.profile.username)}`
                                : `https://solscan.io/account/${trader.wallet}${network === "mainnet-beta" ? "" : "?cluster=devnet"}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            title={trader.wallet}
                          >
                            {trader.profile
                              ? `@${trader.profile.username}`
                              : short(trader.wallet)}
                            <ExternalLink size={12} />
                          </a>
                          {trader.wallet === wallet && <small>You</small>}
                        </div>
                        <button
                          type="button"
                          className="lp-leaderboard-copy"
                          onClick={() => void copy(trader.wallet)}
                          aria-label={`Copy wallet ${trader.wallet}`}
                          title="Copy wallet address"
                        >
                          {copied === trader.wallet ? (
                            <Check size={14} />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    </th>
                    <td
                      title={trader.volumeUsd.toLocaleString("en-US", {
                        style: "currency",
                        currency: "USD",
                        maximumFractionDigits: 2,
                      })}
                    >
                      <NumberFlow
                        value={trader.volumeUsd}
                        locales="en-US"
                        format={{
                          style: "currency",
                          currency: "USD",
                          notation: "compact",
                          maximumFractionDigits: 2,
                        }}
                      />
                    </td>
                    <td className="lp-leaderboard-extra">
                      <strong>{trader.trades.toLocaleString("en-US")}</strong>
                      <small>
                        {trader.buys.toLocaleString("en-US")} buys ·{" "}
                        {trader.sells.toLocaleString("en-US")} sells
                      </small>
                    </td>
                    <td className="lp-leaderboard-extra">
                      {trader.tokens.toLocaleString("en-US")}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {(!current || !current.traders.length) && (
          <p className="lp-leaderboard-empty" role="status">
            {loading
              ? "Loading traders…"
              : error
                ? "Rankings are temporarily unavailable."
                : "No priced trades in this period yet."}
          </p>
        )}
        {pages > 1 && (
          <nav
            className="lp-leaderboard-pagination"
            aria-label="Leaderboard pages"
          >
            <button
              className="lp-secondary"
              disabled={activePage === 0}
              onClick={() => setPage(activePage - 1)}
            >
              Previous
            </button>
            <span>
              {activePage + 1} / {pages}
            </span>
            <button
              className="lp-secondary"
              disabled={activePage + 1 >= pages}
              onClick={() => setPage(activePage + 1)}
            >
              Next
            </button>
          </nav>
        )}
      </section>
      <p className="lp-leaderboard-status" role="status">
        {copied
          ? "Wallet address copied."
          : loading
            ? "Updating rankings…"
            : current
              ? `Updated ${new Date(current.asOf).toISOString().slice(11, 19)} UTC · Refreshes every 30 seconds`
              : ""}
      </p>
      <details className="lp-office-notes">
        <summary>How rankings work</summary>
        <p>
          Ranked by indexed buy and sell volume across OneOnly tokens, including
          trades through other apps. USD values use prices recorded at the time
          of each trade. Unpriced trades and history still being indexed are
          excluded.
        </p>
        <p>
          Wallets are identified from indexed transactions; sponsored routes may
          appear under the transaction payer. Volume measures activity, not
          profit or unique people. Only the top 100 are shown.
        </p>
      </details>
    </section>
  );
}
