"use client";
import { useEffect, useState } from "react";
import { api, useLaunchpad, type Intent } from "./provider";
type Setup = {
  feeWallet: string | null;
  quotes: {
    symbol: string;
    name: string;
    category: string;
    config: string | null;
    launchTokenType?: number;
    setupThreshold: number | null;
    setupTargetUsd: number | null;
  }[];
};
export function MainnetSetup() {
  const app = useLaunchpad();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Setup>("setup")
      .then(setSetup)
      .catch((e) => setError(e.message));
  }, [app.transactionRevision]);
  async function prepare(symbol: string) {
    setBusy(true);
    setError("");
    try {
      await app.authenticate();
      app.review(await api<Intent>("setup", { symbol }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="lp-page-heading">
        <span className="lp-kicker">PLATFORM OWNER</span>
        <h1>Token-2022 upgrade.</h1>
        <p>
          Approve one replacement configuration per pair for future launches.
        </p>
      </div>
      {error && (
        <p role="alert" className="lp-error">
          {error}
        </p>
      )}
      <section className="lp-panel">
        <h2>Platform fee wallet</h2>
        <p style={{ overflowWrap: "anywhere" }}>
          {setup?.feeWallet || "Awaiting the owner’s public wallet address."}
        </p>
        <p className="lp-muted">
          Each configuration is an on-chain transaction that pays account rent
          and a network fee in real SOL. Review the fee receiver, curve fees,
          and graduation threshold before signing.
        </p>
        <p className="lp-muted">
          After confirmation, the configuration address appears in the
          transaction review and Your wallet history. It must be verified and
          activated before new launches use Token-2022. Existing tokens and
          pools keep working.
        </p>
      </section>
      {app.network === "mainnet-beta" &&
        setup?.quotes.map((asset) => (
          <section
            key={asset.symbol}
            className="lp-panel"
            style={{ marginTop: 16 }}
          >
            <h2>
              {asset.name} · {asset.symbol}
            </h2>
            <p>
              {asset.config ? (
                <>
                  {asset.launchTokenType === 1
                    ? "The graduation target, supply and fees are carried over from the previous configuration."
                    : "The current graduation target, supply and fees will be preserved."}
                </>
              ) : asset.setupThreshold === null ? (
                <>
                  Graduation: approximately $
                  {asset.setupTargetUsd?.toLocaleString()} in {asset.symbol}.
                  Your review will show the fixed token quantity.
                </>
              ) : (
                <>
                  Graduation: {asset.setupThreshold.toLocaleString()}{" "}
                  {asset.category === "Stocks" ? "unscaled " : ""}
                  {asset.symbol} tokens.
                </>
              )}
            </p>
            {asset.config && asset.launchTokenType === 1 ? (
              <p className="lp-muted">Token-2022 configuration active.</p>
            ) : (
              <button
                className="lp-primary"
                disabled={busy || !setup.feeWallet}
                onClick={() => void prepare(asset.symbol)}
              >
                Review {asset.symbol} Token-2022 configuration
              </button>
            )}
          </section>
        ))}
    </>
  );
}
