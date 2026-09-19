import Link from "next/link";
export default function Credits() {
  return (
    <section className="lp-panel">
      <h1>Chart credits</h1>
      <p>TradingView Lightweight Charts™</p>
      <p>Copyright © 2025 TradingView, Inc.</p>
      <p>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView
        </a>{" "}
        ·{" "}
        <a
          href="https://github.com/tradingview/lightweight-charts/blob/master/LICENSE"
          target="_blank"
          rel="noreferrer"
        >
          Apache License 2.0
        </a>
      </p>
      <Link href="/app">Back to Explore</Link>
    </section>
  );
}
