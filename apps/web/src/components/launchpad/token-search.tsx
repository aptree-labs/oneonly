"use client";
import { RecipientList } from "../creator-fees/recipients";
import { useLaunchpad } from "./provider";
import { PlatformBadge } from "./platform-token";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  X,
  ChevronRight,
  ChevronLeft,
  LoaderCircle,
} from "lucide-react";
import type { Token } from "./explore";
import { Select } from "./select";
import { AssetIcon } from "./asset-icon";
import { number } from "./provider";
import Link from "next/link";
import { useMarketResults } from "./use-market-results";
import { createTickerHref, createPrefill } from "@/lib/create-prefill";
import { loadMarket, marketKey } from "@/lib/market-results";

const sorts = [
  ["relevance", "Relevance"],
  ["market-cap", "Market cap"],
  ["recent-buys", "Recent buys"],
  ["volume", "24h volume"],
  ["newest", "Newest"],
  ["oldest", "Oldest"],
];
const stocks = ["SPYX", "QQQX", "NVDAX", "TSLAX", "CRCLX"];
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});
function ageLabel(date: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(date)) / 60000),
  );
  if (!Number.isFinite(minutes)) return "";
  return minutes < 1
    ? "Just launched"
    : minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h`
        : `${Math.floor(minutes / 1440)}d`;
}

export function TokenSearch() {
  const [open, setOpen] = useState(false);
  const [initialPair, setInitialPair] = useState("All");
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  function show(pair = "All") {
    opener.current = document.activeElement as HTMLElement;
    setInitialPair(pair);
    setOpen(true);
  }
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        !document.querySelector("dialog[open], .lp-modal-backdrop")
      ) {
        event.preventDefault();
        show();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (!open) return;
    const modal = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.showModal();
    modal.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      modal.close();
      document.body.style.overflow = previousOverflow;
      (opener.current?.isConnected ? opener.current : trigger.current)?.focus({
        preventScroll: true,
      });
    };
  }, [open]);
  return (
    <div className="lp-token-search-entry">
      <button
        ref={trigger}
        type="button"
        className="lp-token-search-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={() =>
          void loadMarket(
            marketKey(new URLSearchParams({ sort: "relevance" })),
          ).catch(() => {})
        }
        onFocus={() =>
          void loadMarket(
            marketKey(new URLSearchParams({ sort: "relevance" })),
          ).catch(() => {})
        }
        onClick={() => show()}
      >
        <Search size={18} aria-hidden="true" />
        <span>Search tokens</span>
        <kbd>⌘ / Ctrl K</kbd>
      </button>
      <dialog
        ref={dialog}
        className="lp-token-search-dialog"
        aria-label="Search tokens"
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        {open && (
          <SearchContents
            initialPair={initialPair}
            onClose={() => setOpen(false)}
          />
        )}
      </dialog>
    </div>
  );
}

function SearchContents({
  initialPair,
  onClose,
}: {
  initialPair: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { network } = useLaunchpad();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("relevance");
  const [pair, setPair] = useState(initialPair);
  const [age, setAge] = useState("All");
  const [page, setPage] = useState(0);
  const [active, setActive] = useState(0);
  const params = new URLSearchParams({
    search: search.trim(),
    sort,
    pair,
    age,
    page: String(page),
  });
  const { data, error, busy, refreshing, reload } = useMarketResults(params);
  const result = data ?? { tokens: [], total: 0 };
  const tokens = result.tokens;
  const key = marketKey(params);
  const [available, setAvailable] = useState<string | null>(null);
  const candidate = createPrefill(search, pair).ticker;
  useEffect(() => {
    setActive(0);
    list.current?.scrollTo({ top: 0 });
  }, [key]);
  useEffect(() => {
    setAvailable(null);
    if (
      busy ||
      error ||
      !candidate ||
      tokens.some((token) => token.ticker === candidate)
    )
      return;
    const controller = new AbortController();
    fetch(`/api/launchpad/ticker?value=${encodeURIComponent(candidate)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        if (!controller.signal.aborted && value?.available)
          setAvailable(candidate);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [candidate, key, busy, error, tokens.length, data?.asOf]);
  useEffect(() => {
    document
      .getElementById(`${id}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, id]);
  function changeFilter(set: (value: string) => void, value: string) {
    set(value);
    setPage(0);
    setActive(0);
  }
  function choose(token: Token) {
    onClose();
    router.push(`/app/token/${token.id}`);
  }
  return (
    <div className="lp-token-search-content">
      <div className="lp-token-search-input">
        <Search size={21} aria-hidden="true" />
        <input
          ref={input}
          aria-label={
            network === "devnet"
              ? "Search tokens or X fee recipients"
              : "Search name, ticker, or contract address"
          }
          placeholder={
            network === "devnet"
              ? "Search tokens or @accounts"
              : "Search name, ticker, or contract address"
          }
          autoComplete="off"
          spellCheck={false}
          maxLength={100}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={`${id}-results`}
          aria-activedescendant={tokens[active] ? `${id}-${active}` : undefined}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (
              (event.key === "ArrowDown" || event.key === "ArrowUp") &&
              tokens.length
            ) {
              event.preventDefault();
              setActive(
                (value) =>
                  (value +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    tokens.length) %
                  tokens.length,
              );
            } else if (event.key === "Enter" && tokens[active]) {
              event.preventDefault();
              choose(tokens[active]);
            }
          }}
        />
        {search && (
          <button
            type="button"
            className="lp-search-clear"
            aria-label="Clear search"
            onClick={() => {
              setSearch("");
              setPage(0);
              input.current?.focus();
            }}
          >
            <X size={17} />
          </button>
        )}
        <button
          type="button"
          className="lp-search-close"
          aria-label="Close search"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      <div className="lp-token-search-filters">
        <div
          role="group"
          aria-label="Sort search results"
          className="lp-search-filter-row"
        >
          <span>Sort by</span>
          <div>
            {sorts.map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={sort === value}
                onClick={() => changeFilter(setSort, value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div
          role="group"
          aria-label="Token age"
          className="lp-search-filter-row"
        >
          <span>Age</span>
          <div>
            {["All", "24h", "7d"].map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={age === value}
                onClick={() => changeFilter(setAge, value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <div
          role="group"
          aria-label="Search pair"
          className="lp-search-filter-row"
        >
          <span>Pair</span>
          <div>
            {["All", "SOL", "USDC", "JUP", "MET"].map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={pair === value}
                onClick={() => changeFilter(setPair, value)}
              >
                <AssetIcon symbol={value} />
                {value}
              </button>
            ))}
            <Select
              label="Filter by stock pair"
              value={pair === "Stocks" || stocks.includes(pair) ? pair : ""}
              onChange={(value) => changeFilter(setPair, value)}
              options={[
                { value: "", label: "Stocks", disabled: true },
                { value: "Stocks", label: "All stocks" },
                ...stocks.map((symbol) => ({ value: symbol, label: symbol })),
              ]}
            />
          </div>
        </div>
      </div>
      <div className="lp-token-search-scroll" ref={list}>
        {network === "devnet" && (
          <RecipientList query={search} compact onChoose={onClose} />
        )}
        <div role="status" className="lp-search-status" aria-live="polite">
          {busy ? (
            <>
              <LoaderCircle size={20} className="lp-spin" />
              Searching…
            </>
          ) : error ? (
            <>
              <span>{error}</span>
              <button className="lp-secondary" onClick={reload}>
                Try again
              </button>
            </>
          ) : !tokens.length ? (
            <>
              <strong>No matching tokens</strong>
              {available === candidate && candidate ? (
                <Link
                  className="lp-primary"
                  href={createTickerHref(candidate, pair)!}
                  onClick={onClose}
                >
                  Create ${candidate}
                  {!["All", "Stocks", "Tokens"].includes(pair)
                    ? ` · ${pair}`
                    : ""}
                </Link>
              ) : (
                <span>Try another search or change the filters.</span>
              )}
            </>
          ) : (
            <span className="lp-search-sr">
              {result.total} matching tokens{refreshing ? ", updating" : ""}
            </span>
          )}
        </div>
        <div
          id={`${id}-results`}
          role="listbox"
          aria-label="Token results"
          aria-busy={busy}
        >
          {tokens.map((token, index) => (
            <button
              key={token.id}
              type="button"
              role="option"
              aria-selected={active === index}
              id={`${id}-${index}`}
              tabIndex={-1}
              className="lp-token-search-result"
              onPointerMove={() => setActive(index)}
              onClick={() => choose(token)}
            >
              <img
                className="lp-search-token-image"
                src={`/api/launchpad/image/${token.imageId}`}
                alt=""
                loading="lazy"
              />
              <span className="lp-search-token-copy">
                <strong>
                  {token.name} <PlatformBadge mint={token.mint} />
                </strong>
                <span>
                  ${token.ticker}
                  <span>
                    {" "}
                    ·{" "}
                    {token.marketCapUsd != null
                      ? usd.format(token.marketCapUsd)
                      : token.snapshot && !token.snapshot.graduated
                        ? `${number(token.snapshot.marketCapQuote)} ${token.quote}`
                        : "—"}{" "}
                    MC
                  </span>
                  {token.activatedAt && (
                    <span> · {ageLabel(token.activatedAt)}</span>
                  )}
                </span>
              </span>
              <span className="lp-search-token-pair">
                <AssetIcon symbol={token.quote} />
                <span>{token.quote}</span>
                {token.snapshot?.graduated && <small>Graduated</small>}
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      </div>
      <footer className="lp-token-search-footer">
        <span>
          {busy
            ? "Searching"
            : error
              ? "Search unavailable"
              : result.total
                ? `${page * 24 + 1}–${Math.min((page + 1) * 24, result.total)} of ${result.total.toLocaleString()}`
                : "0 results"}
        </span>
        {!!tokens.length && available === candidate && candidate && (
          <Link
            className="lp-text-link"
            href={createTickerHref(candidate, pair)!}
            onClick={onClose}
          >
            Create ${candidate}
            {!["All", "Stocks", "Tokens"].includes(pair) ? ` · ${pair}` : ""}
          </Link>
        )}
        <nav aria-label="Search result pages">
          <button
            type="button"
            aria-label="Previous search page"
            disabled={busy || !!error || page === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <span>
            {page + 1} / {Math.max(1, Math.ceil(result.total / 24))}
          </span>
          <button
            type="button"
            aria-label="Next search page"
            disabled={busy || !!error || (page + 1) * 24 >= result.total}
            onClick={() => setPage((value) => value + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </nav>
      </footer>
    </div>
  );
}
