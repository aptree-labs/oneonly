"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Wallet, ArrowUpRight, ExternalLink } from "lucide-react";
import { api, useLaunchpad, number, type Intent } from "./provider";
import { type Token } from "./explore";
type Portfolio = {
  balance: string;
  quoteBalances?: { symbol: string; mint: string; balance: string }[];
  holdings: Token[];
  created: Token[];
  intents: (Intent & { kind: string; createdAt: string })[];
};
export function Portfolio() {
  const app = useLaunchpad(),
    [data, setData] = useState<Portfolio | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    setError("");
    try {
      await app.authenticate();
      setData(await api<Portfolio>("portfolio"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setData(null);
  }, [app.wallet]);
  async function resume(id: string) {
    try {
      app.review(await api<Intent>(`intent/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="lp-page-heading">
        <span className="lp-kicker">YOUR CORNER OF THE WASTELAND</span>
        <h1>
          Keep an eye
          <br />
          on <em>your ones.</em>
        </h1>
        <p>Your holdings, launches, and transaction history.</p>
      </div>
      {error && (
        <p role="alert" className="lp-error">
          {error}
        </p>
      )}
      {!data ? (
        <section className="lp-empty lp-wallet-empty">
          <Wallet size={32} />
          <h2>Make yourself known.</h2>
          <p>
            Connect and sign a message to see your balances and activity.
            <br />
            The sign-in message cannot move your funds.
          </p>
          <button
            className="lp-primary"
            onClick={() => void load()}
            disabled={busy}
          >
            {busy ? "Check your wallet…" : "Open your wallet"}
            <ArrowUpRight size={17} />
          </button>
        </section>
      ) : (
        <>
          <section className="lp-wallet-summary">
            <div>
              <span className="lp-kicker">AVAILABLE BALANCE</span>
              <h2>
                {number(data.balance)} <small>SOL</small>
              </h2>
            </div>
            <div>
              <button
                className="lp-secondary"
                onClick={() => void load()}
                disabled={busy}
              >
                {busy ? "Refreshing…" : "Refresh wallet"}
              </button>
              {app.network === "devnet" && (
                <a
                  className="lp-text-link"
                  href="https://faucet.solana.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  Get devnet SOL <ExternalLink size={13} />
                </a>
              )}
            </div>
          </section>
          <section className="lp-panel lp-trades">
            <h2>Quote assets</h2>
            <div className="lp-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Available</th>
                    <th>Mint</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.quoteBalances ?? []).map((asset) => (
                    <tr key={asset.symbol}>
                      <td>{asset.symbol}</td>
                      <td>{number(asset.balance)}</td>
                      <td>
                        <a
                          className="lp-text-link"
                          href={app.explorer("address", asset.mint)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View mint <ExternalLink size={13} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="lp-panel lp-trades">
            <h2>Your holdings</h2>
            <div className="lp-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Balance</th>
                    <th>Registry</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.holdings.map((token) => (
                    <tr key={token.id}>
                      <td>
                        <Link
                          className="lp-token-cell"
                          href={`/app/token/${token.id}`}
                        >
                          <img
                            src={`/api/launchpad/image/${token.imageId}`}
                            alt=""
                          />
                          ${token.ticker}
                        </Link>
                      </td>
                      <td>{number(token.balance)}</td>
                      <td>{token.status}</td>
                      <td>
                        <Link href={`/app/token/${token.id}`}>Trade ↗</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.holdings.length && (
                <p className="lp-table-empty">
                  No One Only tokens in this wallet yet.{" "}
                  <Link href="/app">Explore tokens ↗</Link>
                </p>
              )}
            </div>
          </section>
          <section className="lp-panel lp-trades">
            <h2>Your launches</h2>
            {data.created.length ? (
              <div className="lp-launch-list">
                {data.created.map((token) => (
                  <Link key={token.id} href={`/app/token/${token.id}`}>
                    <span>
                      ${token.ticker} <small>{token.name}</small>
                    </span>
                    <span>{token.status} ↗</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="lp-table-empty">
                No launches yet.{" "}
                <Link href="/app/create">Create your first token ↗</Link>
              </p>
            )}
          </section>
          <section className="lp-panel lp-trades">
            <h2>Transactions</h2>
            {data.intents.length ? (
              <div className="lp-launch-list">
                {data.intents.map((intent) => (
                  <div key={intent.id}>
                    <span>
                      <strong>{intent.kind}</strong>
                      <small>
                        {new Date(intent.createdAt).toLocaleString()}
                      </small>
                    </span>
                    <span>
                      {intent.status}{" "}
                      {["prepared", "submitted"].includes(intent.status) ||
                      (intent.status === "confirmed" &&
                        intent.kind === "launch-conversion") ? (
                        <button
                          className="lp-text-link"
                          onClick={() => void resume(intent.id)}
                        >
                          Resume ↗
                        </button>
                      ) : intent.signature ? (
                        <a
                          href={app.explorer("tx", intent.signature)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="View transaction"
                        >
                          <ExternalLink size={14} />
                        </a>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="lp-table-empty">
                Your launch, trade, and fee-claim transactions will appear here.
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
}
