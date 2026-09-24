"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, RefreshCw, Rocket } from "lucide-react";
import type { MarketResults } from "@/lib/market-results";
import { TokenCard } from "./explore";
import { useMarketResults } from "./use-market-results";

type Progress = { ids: string[]; total: number; ready: boolean };
/** Each batch owns its refresh timer; offscreen batches pause network activity. */
function TokenBatch({
  page,
  sort,
  pair,
  initial,
  excluded,
  onProgress,
}: {
  page: number;
  sort: string;
  pair: string;
  initial?: MarketResults;
  excluded: Set<string>;
  onProgress: (page: number, progress: Progress) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [nearby, setNearby] = useState(true);
  useEffect(() => {
    if (!element.current || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => setNearby(entry.isIntersecting),
      { rootMargin: "600px" },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const { data, error, busy, reload } = useMarketResults(
    new URLSearchParams({ sort, pair, page: String(page) }),
    initial,
    nearby,
  );
  useEffect(() => {
    onProgress(page, {
      ids: data?.tokens.map((token) => token.id) ?? [],
      total: data?.total ?? 0,
      ready: !!data,
    });
  }, [page, data, onProgress]);
  const tokens = data?.tokens.filter((token) => !excluded.has(token.id)) ?? [];
  return (
    <div ref={element} className="lp-explore-batch" aria-busy={busy}>
      {tokens.length > 0 && (
        <div className="lp-token-grid">
          {tokens.map((token, index) => (
            <TokenCard
              key={token.id}
              token={token}
              priority={page === 0 && index < 4}
            />
          ))}
        </div>
      )}
      {error && (
        <div className="lp-infinite-status">
          <p role="alert">Couldn’t load {page ? "more tokens" : "tokens"}.</p>
          <button className="lp-secondary" onClick={reload}>
            Try again
          </button>
        </div>
      )}
      {busy && !data && (
        <p className="lp-infinite-status" role="status">
          <RefreshCw size={16} className="lp-spin" />
          {page ? "Loading more tokens…" : "Finding the latest launches…"}
        </p>
      )}
      {page === 0 && data?.total === 0 && (
        <div className="lp-empty">
          <span className="lp-empty-icon">
            <Rocket size={26} />
          </span>
          <h3>
            {pair === "All" ? "Unclaimed territory." : "No matching tokens."}
          </h3>
          <p>
            {pair === "All"
              ? "No tokens have launched here yet. The first one could be yours."
              : "Try another pair."}
          </p>
          {pair === "All" && (
            <Link className="lp-text-link" href="/app/create">
              Make the first move <ArrowUpRight size={16} />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
export function InfiniteTokens({
  sort,
  pair,
  initial,
  onTotal,
}: {
  sort: string;
  pair: string;
  initial?: MarketResults;
  onTotal: (total: number) => void;
}) {
  const [pages, setPages] = useState(1);
  const [progress, setProgress] = useState<Record<number, Progress>>({});
  const sentinel = useRef<HTMLDivElement>(null);
  const requested = useRef(0);
  const update = useCallback(
    (page: number, value: Progress) => {
      setProgress((previous) => ({ ...previous, [page]: value }));
      if (value.ready) onTotal(value.total);
    },
    [onTotal],
  );
  const tail = progress[pages - 1];
  const hasMore =
    !!tail?.ready && tail.ids.length === 24 && pages * 24 < tail.total;
  const next = useCallback(() => {
    if (!hasMore || requested.current === pages) return;
    requested.current = pages;
    setPages((value) => value + 1);
  }, [hasMore, pages]);
  useEffect(() => {
    if (!hasMore || !sentinel.current || !("IntersectionObserver" in window))
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          next();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, pages, next]);
  const seen = new Set<string>();
  return (
    <div className="lp-explore-pages">
      {Array.from({ length: pages }, (_, page) => {
        const excluded = new Set(seen);
        for (const id of progress[page]?.ids ?? []) seen.add(id);
        return (
          <TokenBatch
            key={page}
            page={page}
            sort={sort}
            pair={pair}
            initial={page === 0 ? initial : undefined}
            excluded={excluded}
            onProgress={update}
          />
        );
      })}
      <div
        ref={sentinel}
        className="lp-infinite-status"
        data-testid="token-scroll-sentinel"
      >
        {hasMore ? (
          <button className="lp-secondary" onClick={next}>
            Load more tokens
          </button>
        ) : tail?.ready && tail.total > 0 ? (
          <span>You’re all caught up.</span>
        ) : null}
      </div>
    </div>
  );
}
