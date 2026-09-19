"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  createChart,
  AreaSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  LineType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type AutoscaleInfo,
} from "lightweight-charts";
import { api, number, useLaunchpad } from "./provider";
import { Select } from "./select";
import { formatExactAmount } from "@oneonly/core";

type Candle = {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  trades: number;
};
type History = {
  currency: "usd" | "quote";
  fallback?: boolean;
  quoteMultiplier?: number;
  candles: Candle[];
  hasMore: boolean;
  from: number | null;
  through: string | null;
  indexedThrough: string | null;
  graduated: boolean;
  graduatedHistory?: boolean;
  interval: string;
};
const intervals = ["1m", "5m", "15m", "1h", "4h", "1d"];
const usdPrice = (value: string | number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumSignificantDigits: 4,
  }).format(Number(value));

export default function PriceChart({
  id,
  ticker,
  quote: pair,
}: {
  id: string;
  quote: string;
  ticker: string;
}) {
  const { theme, transactionRevision } = useLaunchpad();
  const [currency, setCurrency] = useState("usd");
  const [interval, setInterval] = useState("15m"),
    [before, setBefore] = useState<number | undefined>(),
    [history, setHistory] = useState<History | null>(null),
    [hovered, setHovered] = useState<Candle | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const effectiveCurrency = history?.currency ?? currency;
  const quote = effectiveCurrency === "usd" ? "USD" : pair;
  const price =
    effectiveCurrency === "usd"
      ? usdPrice
      : (value: string | number) =>
          new Intl.NumberFormat("en-US", {
            maximumSignificantDigits: 5,
          }).format(Number(value));
  const container = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi | null>(null),
    candles = useRef<ISeriesApi<"Area"> | null>(null),
    volumes = useRef<ISeriesApi<"Histogram"> | null>(null),
    data = useRef<Candle[]>([]),
    fitNext = useRef(true);
  useEffect(() => {
    const instance = createChart(container.current!, {
      autoSize: true,
      height: 360,
      layout: {
        background: { type: ColorType.Solid, color: "#e8e9d3" },
        textColor: "#5d6d55",
        fontFamily: "Space Grotesk, sans-serif",
        fontSize: 11,
        // The public credits page carries the required chart attribution.
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "#d6dbc5" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#b5bfa7",
        rightOffset: 4,
        barSpacing: 12,
      },
      rightPriceScale: {
        borderColor: "#b5bfa7",
        scaleMargins: { top: 0.12, bottom: 0.28 },
      },
      handleScroll: { vertTouchDrag: false },
    });
    chart.current = instance;
    candles.current = instance.addSeries(AreaSeries, {
      lineColor: "#527b44",
      topColor: "#75974e66",
      bottomColor: "#75974e00",
      lineWidth: 2,
      lineType: LineType.Curved,
      crosshairMarkerRadius: 5,
      pointMarkersVisible: false,
      pointMarkersRadius: 2,
      priceLineVisible: false,
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const scale = original();
        if (!scale?.priceRange) return scale;
        const { minValue, maxValue } = scale.priceRange;
        // A flat/single-point series needs a visible range, not ticks that
        // collapse to the same rounded price. This changes the axis only.
        if (minValue > 0 && maxValue - minValue < maxValue * 0.001) {
          const middle = (minValue + maxValue) / 2;
          return {
            ...scale,
            priceRange: { minValue: middle * 0.995, maxValue: middle * 1.005 },
          };
        }
        return scale;
      },
      priceFormat: {
        type: "custom",
        minMove: 1e-12,
        formatter: price,
      },
    });
    volumes.current = instance.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumes.current
      .priceScale()
      .applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    instance.subscribeCrosshairMove((event) =>
      setHovered(data.current.find((bar) => bar.time === event.time) ?? null),
    );
    return () => {
      instance.remove();
      chart.current = null;
      candles.current = null;
      volumes.current = null;
      data.current = [];
    };
  }, []);
  useEffect(() => {
    const dark = theme === "dark";
    chart.current?.applyOptions({
      layout: {
        background: {
          type: ColorType.Solid,
          color: dark ? "#1c241c" : "#e8e9d3",
        },
        textColor: dark ? "#aebda2" : "#5d6d55",
      },
      grid: { horzLines: { color: dark ? "#303c2d" : "#d6dbc5" } },
      timeScale: { borderColor: dark ? "#3c4a36" : "#b5bfa7" },
      rightPriceScale: { borderColor: dark ? "#3c4a36" : "#b5bfa7" },
    });
    candles.current?.applyOptions({
      lineColor: dark ? "#c4df83" : "#527b44",
      topColor: dark ? "#b7d77c44" : "#75974e66",
      bottomColor: dark ? "#b7d77c00" : "#75974e00",
    });
  }, [theme]);
  useEffect(() => {
    let live = true,
      fetching = false;
    fitNext.current = true;
    setLoading(true);
    setError("");
    setHovered(null);
    setHistory(null);
    candles.current?.setData([]);
    volumes.current?.setData([]);
    data.current = [];
    const load = async () => {
      if (fetching || document.hidden) return;
      fetching = true;
      try {
        const params = new URLSearchParams({
          interval,
          currency,
          fallback: "quote",
        });
        if (before !== undefined) params.set("before", String(before));
        const result = await api<History>(`candles/${id}?${params}`);
        if (live) {
          // Keep malformed/non-finite points out of the chart runtime.
          const points = new Map<number, Candle>();
          for (const bar of result.candles) {
            if (
              Number.isFinite(bar.time) &&
              Number(bar.close) > 0 &&
              [bar.open, bar.high, bar.low, bar.close, bar.volume].every(
                (value) =>
                  value.trim() !== "" && Number.isFinite(Number(value)),
              )
            )
              points.set(bar.time, bar);
          }
          setHistory({
            ...result,
            candles: [...points.values()].sort((a, b) => a.time - b.time),
          });
          setError("");
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        fetching = false;
        if (live) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (before === undefined) void load();
    }, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id, interval, before, revision, currency, transactionRevision]);
  useEffect(() => {
    if (
      !history ||
      !candles.current ||
      !volumes.current ||
      history.interval !== interval
    )
      return;
    const bars = history.candles;
    candles.current.applyOptions({
      pointMarkersVisible: bars.length === 1,
      priceFormat: { type: "custom", minMove: 1e-12, formatter: price },
    });
    const prices = bars.map((bar) => ({
      time: bar.time as UTCTimestamp,
      value: Number(bar.close),
    }));
    const volume = bars.map((bar) => ({
      time: bar.time as UTCTimestamp,
      value: Number(bar.volume),
      color: Number(bar.close) >= Number(bar.open) ? "#527b4480" : "#b0656580",
    }));
    const previous = data.current;
    const canUpdate =
      previous.length > 0 &&
      bars.length >= previous.length &&
      !fitNext.current &&
      previous
        .slice(0, -1)
        .every((bar, i) => JSON.stringify(bar) === JSON.stringify(bars[i]));
    if (canUpdate) {
      for (let i = previous.length - 1; i < bars.length; i++) {
        candles.current.update(prices[i]);
        volumes.current.update(volume[i]);
      }
    } else {
      candles.current.setData(prices);
      volumes.current.setData(volume);
    }
    data.current = bars;
    if (fitNext.current && bars.length) {
      chart.current?.timeScale().fitContent();
      fitNext.current = false;
    }
  }, [history, interval, effectiveCurrency]);
  const selected = hovered ?? history?.candles.at(-1);
  const first = history?.candles[0];
  const change =
    first && selected && Number(first.close) > 0
      ? (Number(selected.close) / Number(first.close) - 1) * 100
      : null;
  return (
    <section className="lp-trading-chart" aria-label={`${ticker} price chart`}>
      <div className="lp-chart-controls">
        <Select
          label="Chart price currency"
          value={currency}
          onChange={(value) => {
            setCurrency(value);
            setBefore(undefined);
          }}
          options={[
            { value: "usd", label: "USD" },
            { value: "quote", label: pair },
          ]}
        />
        <div className="lp-timeframes" role="group" aria-label="Chart interval">
          {intervals.map((value) => (
            <button
              key={value}
              aria-pressed={interval === value}
              onClick={() => {
                setInterval(value);
                setBefore(undefined);
              }}
            >
              {value}
            </button>
          ))}
        </div>
        <button
          className="lp-chart-reset"
          onClick={() => chart.current?.timeScale().fitContent()}
        >
          Fit chart
        </button>
      </div>
      {history?.fallback && (
        <p className="lp-muted" role="status">
          USD history unavailable · Showing {pair}
        </p>
      )}
      <div className="lp-line-summary" aria-label="Chart price">
        <span className="lp-muted">
          {ticker} price · {quote}
        </span>
        <strong
          title={
            selected
              ? `${formatExactAmount(selected.close)} ${quote}`
              : undefined
          }
        >
          {selected && !loading ? price(selected.close) : "—"}{" "}
          <small>{quote}</small>
        </strong>
        <div className="lp-line-context">
          {change !== null &&
            Number.isFinite(change) &&
            !loading &&
            (history?.candles.length ?? 0) > 1 && (
              <span className={change >= 0 ? "lp-line-up" : "lp-line-down"}>
                {change > 0 ? "+" : ""}
                {number(change)}%{" "}
                <span className="lp-muted">since first point shown</span>
              </span>
            )}
          {selected && !loading && (
            <span className="lp-muted">
              {hovered ? "Selected" : "Latest"} interval ·{" "}
              {new Date(selected.time * 1000).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZone: "UTC",
              })}{" "}
              UTC
            </span>
          )}
        </div>
      </div>
      <div className="lp-chart-stage">
        <div
          className="lp-candle-canvas"
          ref={container}
          aria-label="Interactive line chart with volume bars"
        />
        {(loading || !history?.candles.length || (error && !history)) && (
          <div className="lp-chart-overlay" role="status">
            {loading ? (
              "Loading price history…"
            ) : error ? (
              <>
                {error}
                <button
                  className="lp-secondary"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  Retry chart
                </button>
              </>
            ) : history?.through ? (
              "USD history is not available for these trades yet."
            ) : (
              "Waiting for indexed trades…"
            )}
          </div>
        )}
      </div>
      {error && history && (
        <p className="lp-notice" role="alert">
          Chart refresh failed. Showing the last available history.{" "}
          <button
            className="lp-text-link"
            onClick={() => setRevision((value) => value + 1)}
          >
            Retry
          </button>
        </p>
      )}
      <div className="lp-chart-history-controls">
        <button
          className="lp-chart-reset"
          disabled={loading || !history?.hasMore}
          onClick={() => {
            if (history?.from != null) setBefore(history.from);
          }}
        >
          Earlier history
        </button>
        {before !== undefined && (
          <button
            className="lp-chart-reset"
            onClick={() => setBefore(undefined)}
          >
            Latest trades
          </button>
        )}
        <span>
          {history?.candles.length ?? 0} price{" "}
          {history?.candles.length === 1 ? "point" : "points"} · UTC
        </span>
      </div>
      <details className="lp-candle-accessible">
        <summary>View chart data</summary>
        <div className="lp-table-scroll">
          <table>
            <caption>Execution prices in {quote} · times in UTC</caption>
            <thead>
              <tr>
                <th>Time</th>
                <th>Open</th>
                <th>High</th>
                <th>Low</th>
                <th>Close</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              {history?.candles
                .slice(-100)
                .reverse()
                .map((bar) => (
                  <tr key={bar.time}>
                    <td>
                      {new Date(bar.time * 1000)
                        .toISOString()
                        .slice(0, 16)
                        .replace("T", " ")}
                    </td>
                    {[bar.open, bar.high, bar.low, bar.close, bar.volume].map(
                      (value, i) => (
                        <td key={i}>{formatExactAmount(value)}</td>
                      ),
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="lp-chart-credit">
        <Link href="/app/credits">Chart credits</Link>
      </p>
    </section>
  );
}
