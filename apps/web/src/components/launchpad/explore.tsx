"use client";
import { PlatformBadge } from "./platform-token";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { ArrowUpRight, Rocket, RefreshCw, Copy, Check } from "lucide-react";
import { number, short, useLaunchpad } from "./provider";
import { TokenSearch } from "./token-search";
import { useMarketResults } from "./use-market-results";
import type { MarketResults } from "@/lib/market-results";
export type Token = {
  id: string;
  ticker: string;
  name: string;
  description: string;
  projectLinks?: import("@oneonly/core").ProjectLinks | null;
  imageId: string;
  quote: string;
  creator: string;
  mint: string;
  pool: string;
  status: string;
  activatedAt: string;
  balance?: string;
  marketCapUsd?: number | null;
  priceUsd?: number | null;
  reserveUsd?: number | null;
  usdReferenceTime?: number | null;
  volumeUsd24h?: number | null;
  volumeComplete?: boolean;
  snapshot: {
    priceQuote: string;
    marketCapQuote: string;
    progress: number;
    quoteReserve: string;
    graduated: boolean;
    marketVenue?: string;
    readyToMigrate?: boolean;
    dammPool?: string | null;
    creatorQuoteFee: string;
    updatedAt: string;
  } | null;
};
export function TokenCard({
  token,
  priority = false,
}: {
  token: Token;
  priority?: boolean;
}) {
  const app = useLaunchpad();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(token.mint);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      app.setNotice(`Contract address: ${token.mint}`);
    }
  }
  const usd = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(value);
  return (
    <article className="lp-token-card">
      <div className="lp-token-cover">
        <img
          src={`/api/launchpad/image/${token.imageId}`}
          alt=""
          loading={priority ? "eager" : "lazy"}
        />
        <span className="lp-stamp">
          {token.snapshot?.graduated ? "GRADUATED" : `${token.quote} PAIR`}
        </span>
      </div>
      <div className="lp-token-body">
        <div className="lp-row">
          <h3>
            <Link
              className="lp-token-card-link"
              href={`/app/token/${token.id}`}
            >
              ${token.ticker} <PlatformBadge mint={token.mint} />
            </Link>
          </h3>
          <ArrowUpRight size={18} />
        </div>
        <p className="lp-muted">{token.name}</p>
        <button
          type="button"
          className="lp-card-ca"
          onClick={copyAddress}
          title={token.mint}
          aria-label={`Copy ${token.ticker} contract address`}
        >
          <span className="lp-card-ca-label">CA</span>
          <span aria-live="polite">
            {copied ? "Copied" : short(token.mint)}
          </span>
          {copied ? (
            <Check size={13} aria-hidden="true" />
          ) : (
            <Copy size={13} aria-hidden="true" />
          )}
        </button>
        <div className="lp-row lp-card-metric">
          <span>
            {token.marketCapUsd === undefined
              ? "Market cap"
              : "Market cap · USD"}
          </span>
          <strong>
            {token.marketCapUsd === undefined && !token.snapshot?.graduated
              ? `${number(token.snapshot?.marketCapQuote)} ${token.quote}`
              : token.marketCapUsd == null
                ? token.snapshot?.graduated
                  ? "Awaiting DAMM data"
                  : "—"
                : usd(token.marketCapUsd)}
          </strong>
        </div>
        {token.volumeUsd24h !== undefined && (
          <div className="lp-row lp-card-volume">
            <span>
              {token.volumeComplete ? "24h volume" : "Indexed 24h vol."}
            </span>
            <strong>
              {token.volumeUsd24h == null ? "—" : usd(token.volumeUsd24h)}
            </strong>
          </div>
        )}
        <div className="lp-progress">
          <span style={{ width: `${token.snapshot?.progress ?? 0}%` }} />
        </div>
        <div className="lp-row lp-caption">
          <span>
            {token.snapshot?.graduated
              ? "Graduated · DAMM v2"
              : "To graduation"}
          </span>
          <span>
            {token.snapshot?.graduated
              ? `${token.quote} pair`
              : token.snapshot
                ? `${number(token.snapshot.progress)}%`
                : "Awaiting pool data"}
          </span>
        </div>
      </div>
    </article>
  );
}
function PeeCharacter() {
  const [active, setActive] = useState(false);
  const sound = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      sound.current?.pause();
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      className="lp-pee-character"
      aria-label="Make the degen pee"
      aria-pressed={active}
      onClick={() => {
        if (timer.current) clearTimeout(timer.current);
        sound.current ??= new Audio("/sounds/pee-v2.mp3");
        sound.current.currentTime = 0;
        sound.current.volume = 0.45;
        void sound.current.play().catch(() => {});
        setActive(true);
        timer.current = setTimeout(() => {
          setActive(false);
          sound.current?.pause();
        }, 5000);
      }}
    >
      <img
        src={active ? "/scene/pissing-320.webp" : "/scene/pressed-320.webp"}
        alt=""
      />
      <span>{active ? "no copies. no shame." : "press me ↗"}</span>
    </button>
  );
}
export function Explore({ initial }: { initial?: MarketResults }) {
  const [filter, setFilter] = useState("All"),
    [sort, setSort] = useState("volume"),
    [page, setPage] = useState(0);
  const params = new URLSearchParams({
    sort,
    pair: filter,
    page: String(page),
  });
  const {
    data,
    error,
    busy: loading,
    reload,
  } = useMarketResults(params, initial);
  const tokens = data?.tokens ?? [],
    total = data?.total ?? 0;
  return (
    <>
      <section className="lp-explore-hero">
        <div>
          <h1>
            One Ticker, No Copies,
            <br />
            <em>Pair with anything</em>
          </h1>
          <p>bought a ticker and watched the duplicate run? Not on OneOnly</p>
          <Link className="lp-primary" href="/app/create">
            Launch a token <ArrowUpRight size={19} />
          </Link>
        </div>
        <PeeCharacter />
      </section>
      <div className="lp-market-heading">
        <div>
          <h2>
            Out in the wild <span className="lp-count">{total}</span>
          </h2>
          <p className="lp-muted">
            On the curve or graduated. All One Only listings, in one place.
          </p>
        </div>
        <button
          className="lp-icon-button"
          aria-label="Refresh tokens"
          onClick={reload}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <section className="lp-market-controls" aria-label="Discover tokens">
        <div className="lp-market-toprow">
          <TokenSearch />
          <div className="lp-market-sort" role="group" aria-label="Sort tokens">
            <span>Sort</span>
            {[
              ["market-cap", "Market Cap"],
              ["recent-buys", "Recent buys"],
              ["newest", "Newest"],
              ["volume", "24h Volume"],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={sort === value}
                onClick={() => {
                  setSort(value);
                  setPage(0);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="lp-pair-filters" role="group" aria-label="Paired with">
          <span>Paired with</span>
          {["All", "SOL"].map((value) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setPage(0);
              }}
            >
              {value}
            </button>
          ))}
        </div>
      </section>
      {error && !data ? (
        <div className="lp-empty">
          <h3>Couldn’t reach the registry.</h3>
          <p role="alert">{error}</p>
          <button className="lp-secondary" onClick={reload}>
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="lp-empty" aria-live="polite">
          Finding the latest launches…
        </div>
      ) : tokens.length ? (
        <div className="lp-token-grid">
          {tokens.map((token, index) => (
            <TokenCard key={token.id} token={token} priority={index < 4} />
          ))}
        </div>
      ) : (
        <div className="lp-empty">
          <span className="lp-empty-icon">
            <Rocket size={26} />
          </span>
          <h3>
            {filter === "All" ? "Unclaimed territory." : "No matching tokens."}
          </h3>
          <p>
            {filter === "All"
              ? "No tokens have launched here yet. The first one could be yours."
              : "Try another pair."}
          </p>
          {filter === "All" && (
            <Link className="lp-text-link" href="/app/create">
              Make the first move <ArrowUpRight size={16} />
            </Link>
          )}
        </div>
      )}
      {!loading && !error && (total > 24 || page > 0) && (
        <nav className="lp-pagination" aria-label="Token pages">
          <button
            className="lp-secondary"
            disabled={page === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>
          <span>
            Page {page + 1}
            {total ? ` of ${Math.ceil(total / 24)}` : ""}
          </span>
          <button
            className="lp-secondary"
            disabled={(page + 1) * 24 >= total}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </nav>
      )}
      <div className="lp-rules-strip">
        <span className="lp-rule-number">3 DAYS</span>
        <div>
          <strong>A ticker has to earn its place.</strong>
          <p>
            If every pool stays below $100 in daily volume for three complete
            days, the ticker becomes available again. Existing tokens stay
            on-chain.
          </p>
        </div>
      </div>
    </>
  );
}
