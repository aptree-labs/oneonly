"use client";
import { PlatformBadge, PlatformBanner } from "./platform-token";
import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, ExternalLink, Copy, BadgeCheck, Globe } from "lucide-react";
import { api, number, short, useLaunchpad, type Intent } from "./provider";
import { TraderComments } from "./comments";
import type { Token } from "./explore";
import { UsdValue } from "./usd-value";
import { TradePanel } from "./trade-panel";
type Trade = {
  id: string;
  side: string;
  baseAmount: string;
  quoteAmount: string;
  priceQuote: string;
  blockTime: string;
  wallet: string;
  signature: string;
};
export type Detail = Token & { trades: Trade[]; stale: boolean };
const PriceChart = dynamic(() => import("./price-chart"), {
  ssr: false,
  loading: () => <div className="lp-chart-empty">Loading chart…</div>,
});
const usdMarketCap = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});
export function TokenDetail({ id, initial }: { id: string; initial?: Detail }) {
  const app = useLaunchpad(),
    [token, setToken] = useState<Detail | null>(initial ?? null),
    [error, setError] = useState(""),
    [tradeError, setTradeError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true,
      loading = false;
    const load = () => {
      if (loading || document.hidden) return;
      loading = true;
      return api<Detail>(`token/${id}`)
        .then((data) => {
          if (live) {
            setToken(data);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          loading = false;
        });
    };
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id, app.transactionRevision]);
  async function claim(venue = "dbc") {
    setBusy(true);
    setTradeError("");
    try {
      await app.authenticate();
      app.review(await api<Intent>("claim", { tokenId: id, venue }));
    } catch (e) {
      setTradeError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!token)
    return (
      <div className="lp-empty">
        {error ? (
          <>
            <h2>Couldn’t load this token.</h2>
            <p role="alert">{error}</p>
            <Link href="/app" className="lp-text-link">
              Back to explore
            </Link>
          </>
        ) : (
          "Reading the pool…"
        )}
      </div>
    );
  return (
    <>
      <div className="lp-token-tools">
        <Link href="/app" className="lp-back">
          <ArrowLeft size={16} /> Explore
        </Link>
      </div>
      <PlatformBanner mint={token.mint} />
      <header className="lp-token-heading">
        <img src={`/api/launchpad/image/${token.imageId}`} alt="" />
        <div>
          <span className="lp-kicker">
            {token.status === "released"
              ? "TICKER RELEASED"
              : token.snapshot?.graduated
                ? "GRADUATED"
                : "ON THE CURVE"}
          </span>
          <h1>
            ${token.ticker} <PlatformBadge mint={token.mint} />{" "}
            <small>{token.name}</small>
          </h1>
          <button
            className="lp-text-link"
            onClick={() =>
              navigator.clipboard
                .writeText(token.mint)
                .then(() => app.setNotice("Mint address copied."))
                .catch(() => app.setNotice(`Mint address: ${token.mint}`))
            }
          >
            {short(token.mint)} <Copy size={13} />
          </button>
        </div>
      </header>
      {token.status === "released" && (
        <p className="lp-notice">
          This ticker was released after inactivity. This is the original token;
          always check the mint address before trading.
        </p>
      )}
      {(token.stale || error) && (
        <p className="lp-notice">
          Pool data could not be refreshed. Showing the last available snapshot.
        </p>
      )}
      <div className="lp-token-sections">
        <section className="lp-panel lp-about">
          <h2>{token.description ? "The story" : "About the token"}</h2>
          {token.description && <p>{token.description}</p>}
          {token.projectLinks && (
            <div className="lp-project-links">
              {token.projectLinks.x && (
                <a
                  href={token.projectLinks.x.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lp-project-link"
                >
                  {token.projectLinks.x.avatar && (
                    <img
                      src={token.projectLinks.x.avatar}
                      alt=""
                      width={22}
                      height={22}
                      referrerPolicy="no-referrer"
                    />
                  )}
                  @{token.projectLinks.x.username}
                  {token.projectLinks.x.verified && (
                    <BadgeCheck
                      size={17}
                      aria-label="Verified creator X account"
                      role="img"
                    >
                      <title>
                        X account verified with the creator’s wallet at launch
                      </title>
                    </BadgeCheck>
                  )}
                  <ExternalLink size={13} />
                </a>
              )}
              {(["website", "telegram", "discord"] as const).map(
                (key) =>
                  token.projectLinks?.[key] && (
                    <a
                      key={key}
                      href={token.projectLinks[key]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lp-project-link"
                    >
                      {key === "website" && <Globe size={15} />}
                      {key[0].toUpperCase() + key.slice(1)}{" "}
                      <ExternalLink size={13} />
                    </a>
                  ),
              )}
            </div>
          )}
          <div className="lp-row">
            <span className="lp-muted">Created by {short(token.creator)}</span>
            <a
              className="lp-text-link"
              href={app.explorer("address", token.mint)}
              target="_blank"
              rel="noreferrer"
            >
              View mint <ExternalLink size={13} />
            </a>
          </div>
        </section>
        <div className="lp-detail-grid">
          <div className="lp-token-content">
            <div className="lp-panel lp-chart-panel">
              <div className="lp-metrics">
                <div>
                  <span>Market cap · USD</span>
                  <strong
                    title={
                      token.marketCapUsd != null
                        ? new Intl.NumberFormat("en-US", {
                            style: "currency",
                            currency: "USD",
                          }).format(token.marketCapUsd)
                        : "USD price unavailable"
                    }
                  >
                    {token.marketCapUsd != null
                      ? usdMarketCap.format(token.marketCapUsd)
                      : "—"}
                  </strong>
                  <span className="lp-market-cap-quote">
                    {number(token.snapshot?.marketCapQuote)} {token.quote}
                  </span>
                </div>
                <div>
                  <span>Price</span>
                  <strong>
                    <UsdValue value={token.priceUsd} />
                  </strong>
                </div>
                <div>
                  <span>
                    {token.snapshot?.graduated
                      ? "Pool quote balance"
                      : "Curve reserve"}
                  </span>
                  <strong>
                    <UsdValue value={token.reserveUsd} />
                  </strong>
                </div>
              </div>
              <PriceChart id={id} quote={token.quote} ticker={token.ticker} />
            </div>
          </div>
          <aside id="token-trading-panel">
            <TradePanel key={token.id} token={token} />
            {tradeError && (
              <p role="alert" className="lp-error">
                {tradeError}
              </p>
            )}
            <div className="lp-panel lp-graduation">
              <span className="lp-kicker">
                {token.snapshot?.graduated ? "GRADUATED" : "NEXT STOP: DAMM V2"}
              </span>
              <h3>
                {token.snapshot?.graduated
                  ? "A whole new market."
                  : `${number(token.snapshot?.progress)}% to graduation`}
              </h3>
              <div className="lp-progress">
                <span style={{ width: `${token.snapshot?.progress ?? 0}%` }} />
              </div>
              {token.snapshot?.readyToMigrate && (
                <button
                  type="button"
                  className="lp-primary lp-full"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setTradeError("");
                    try {
                      await app.authenticate();
                      app.review(await api<Intent>("migrate", { tokenId: id }));
                    } catch (e) {
                      setTradeError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Review graduation
                </button>
              )}
              {token.snapshot?.dammPool && (
                <a
                  className="lp-text-link"
                  href={app.explorer("address", token.snapshot.dammPool)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View graduated pool <ExternalLink size={13} />
                </a>
              )}
            </div>
            {app.wallet === token.creator && (
              <div className="lp-panel lp-graduation">
                <h3>Your curve creator fees</h3>
                <strong>
                  {number(token.snapshot?.creatorQuoteFee)} {token.quote}
                </strong>
                <button
                  className="lp-secondary lp-full"
                  disabled={busy || !Number(token.snapshot?.creatorQuoteFee)}
                  onClick={() => void claim()}
                >
                  Claim fee
                </button>
                {token.snapshot?.graduated && (
                  <button
                    type="button"
                    className="lp-secondary lp-full"
                    disabled={busy}
                    onClick={() => void claim("damm-v2")}
                  >
                    Review graduated fee claim
                  </button>
                )}
              </div>
            )}
          </aside>
        </div>
        <TraderComments tokenId={id} />
        <section className="lp-panel lp-trades">
          <div className="lp-section-heading">
            <h2>Recent trades</h2>
          </div>
          <div className="lp-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Side</th>
                  <th>{token.ticker}</th>
                  <th>{token.quote}</th>
                  <th>Fee payer</th>
                </tr>
              </thead>
              <tbody>
                {token.trades.map((trade) => (
                  <tr key={trade.id}>
                    <td>
                      <a
                        href={app.explorer("tx", trade.signature)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {new Date(trade.blockTime).toLocaleTimeString()}
                      </a>
                    </td>
                    <td
                      className={
                        trade.side === "buy" ? "lp-valid" : "lp-sell-text"
                      }
                    >
                      {trade.side}
                    </td>
                    <td>{number(trade.baseAmount)}</td>
                    <td>{number(trade.quoteAmount)}</td>
                    <td>{short(trade.wallet)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!token.trades.length && (
              <p className="lp-table-empty">No trades yet.</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
