"use client";
import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { UsdValue } from "./usd-value";
import NumberFlow from "@number-flow/react";
import { normalizeAmount, formatExactAmount } from "@oneonly/core";

type Quote = {
  output: string;
  minimumOutput: string;
  outputSymbol: string;
  quotedAt: string;
};
export function TradePreview({
  tokenId,
  side,
  settlement,
  amount,
  slippageBps,
  paused,
  usdPrice,
}: {
  tokenId: string;
  side: "buy" | "sell";
  settlement: string;
  amount: string;
  slippageBps: number;
  paused: boolean;
  usdPrice?: number | null;
}) {
  const [retry, setRetry] = useState(0);
  let normalized = "";
  try {
    normalized = normalizeAmount(
      /^\d+[.,]$/.test(amount.trim()) ? amount.trim().slice(0, -1) : amount,
    );
  } catch {
    /* Partial input isn't a quote request. */
  }
  const valid = normalized !== "" && Number(normalized) > 0;
  const group = `${tokenId}:${side}:${settlement}`;
  const key = `${group}:${normalized}:${slippageBps}`;
  const [state, setState] = useState<{
    key: string;
    group: string;
    quote: Quote | null;
    status: "loading" | "ready" | "error";
  }>({ key: "", group: "", quote: null, status: "loading" });
  useEffect(() => {
    if (!valid || paused) return;
    let live = true;
    let refresh: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const load = async () => {
      if (!live) return;
      if (document.hidden) {
        refresh = setTimeout(load, 15_000);
        return;
      }
      setState((previous) => ({
        key,
        group,
        quote: previous.group === group ? previous.quote : null,
        status: "loading",
      }));
      try {
        const params = new URLSearchParams({
          side,
          settlement,
          amount: normalized,
          slippageBps: String(slippageBps),
        });
        const response = await fetch(
          `/api/launchpad/trade-preview/${encodeURIComponent(tokenId)}?${params}`,
          {
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(20_000),
            ]),
          },
        );
        const data = await response.json();
        if (
          !response.ok ||
          typeof data.output !== "string" ||
          !Number.isFinite(Number(data.output)) ||
          Number(data.output) <= 0
        )
          throw new Error("Quote unavailable");
        if (live) setState({ key, group, quote: data, status: "ready" });
      } catch {
        if (live) setState({ key, group, quote: null, status: "error" });
      } finally {
        if (live) refresh = setTimeout(load, 15_000);
      }
    };
    const debounce = setTimeout(load, 350);
    return () => {
      live = false;
      controller.abort();
      clearTimeout(debounce);
      clearTimeout(refresh);
    };
  }, [
    tokenId,
    side,
    settlement,
    normalized,
    slippageBps,
    key,
    group,
    valid,
    paused,
    retry,
  ]);
  const quote = valid && state.group === group ? state.quote : null;
  const loading = valid && (state.key !== key || state.status === "loading");
  const failed = valid && state.key === key && state.status === "error";
  const empty =
    !amount.trim() || (normalized !== "" && Number(normalized) === 0);
  const value = quote ? Number(quote.output) : empty ? 0 : null;
  return (
    <>
      <strong
        className={`lp-swap-quote${loading ? " is-updating" : ""}`}
        aria-label="Estimated receive amount"
        aria-busy={loading}
        title={quote ? formatExactAmount(quote.output) : undefined}
      >
        {value === null ? (
          loading ? (
            <span className="lp-quote-skeleton" aria-hidden="true" />
          ) : (
            "—"
          )
        ) : (
          <NumberFlow
            value={value}
            locales="en-US"
            format={
              value >= 1000
                ? { notation: "compact", maximumFractionDigits: 2 }
                : value > 0 && value < 1
                  ? { maximumSignificantDigits: 4 }
                  : { maximumFractionDigits: 4 }
            }
            transformTiming={{ duration: 300, easing: "ease-out" }}
          />
        )}
      </strong>
      <span className="lp-swap-usd" aria-label="Estimated receive value in USD">
        <UsdValue
          value={value == null || usdPrice == null ? null : value * usdPrice}
        />
      </span>
      <span className="lp-swap-quote-note" role="status">
        {loading ? (
          <>
            <LoaderCircle size={14} className="lp-spin" aria-hidden="true" />{" "}
            Getting quote…
          </>
        ) : failed ? (
          <>
            Quote unavailable{" "}
            <button
              type="button"
              className="lp-text-link"
              onClick={() => {
                setState((previous) => ({ ...previous, status: "loading" }));
                setRetry((value) => value + 1);
              }}
            >
              <RefreshCw size={12} /> Retry
            </button>
          </>
        ) : quote ? (
          "Estimated"
        ) : empty ? (
          ""
        ) : (
          "Invalid amount"
        )}
      </span>
      {quote && !loading && (
        <details className="lp-trade-details">
          <summary>Trade details</summary>
          <p>
            Minimum received: {formatExactAmount(quote.minimumOutput)}{" "}
            {quote.outputSymbol}
          </p>
          <p>Slippage: {slippageBps / 100}% · Network fees apply</p>
        </details>
      )}
    </>
  );
}
