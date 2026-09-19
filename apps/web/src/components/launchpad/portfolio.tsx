"use client";
import { PlatformBadge } from "./platform-token";
import { useState, useEffect, useRef, useCallback } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import { Wallet, ArrowUpRight, ExternalLink, LoaderCircle } from "lucide-react";
import { api, useLaunchpad, number, type Intent } from "./provider";
import { type Token } from "./explore";
import { loadPortfolioForWallet } from "@/lib/portfolio-access";
import { ApiError } from "@/lib/trade-submission";
type Portfolio = {
  wallet: string;
  balance: string;
  quoteBalances?: { symbol: string; mint: string; balance: string }[];
  holdings: Token[];
  created: Token[];
  intents: (Intent & { kind: string; createdAt: string })[];
};
export function Portfolio() {
  const app = useLaunchpad();
  const modal = useWalletModal();
  const [state, setState] = useState<{
    wallet: string | null;
    data: Portfolio | null;
    status: "loading" | "ready" | "signin" | "error";
    error: string;
  }>({ wallet: null, data: null, status: "loading", error: "" });
  const request = useRef(0);
  const activeWallet = useRef(app.wallet);
  activeWallet.current = app.wallet;
  const authenticate = useRef(app.authenticate);
  authenticate.current = app.authenticate;
  const load = useCallback(
    async (signIn = false) => {
      const wallet = app.wallet;
      if (!wallet) return;
      const id = ++request.current;
      const current = () =>
        request.current === id && activeWallet.current === wallet;
      setState((previous) => ({
        wallet,
        data: previous.wallet === wallet ? previous.data : null,
        status: "loading",
        error: "",
      }));
      try {
        const data = await loadPortfolioForWallet(
          wallet,
          () => api<{ wallet: string | null }>("session"),
          () => api<Portfolio>("portfolio"),
          signIn
            ? () => (current() ? authenticate.current() : Promise.resolve(""))
            : undefined,
        );
        if (current())
          setState({
            wallet,
            data,
            status: data ? "ready" : "signin",
            error: "",
          });
      } catch (e) {
        if (!current()) return;
        const needsSignIn = e instanceof ApiError && e.status === 401;
        setState((previous) => ({
          ...previous,
          data: needsSignIn ? null : previous.data,
          status: needsSignIn ? "signin" : "error",
          error: needsSignIn ? "" : (e as Error).message,
        }));
      }
    },
    [app.wallet],
  );
  useEffect(() => {
    if (app.wallet) void load();
    return () => {
      request.current += 1;
    };
  }, [app.wallet, app.transactionRevision, load]);
  const data = state.wallet === app.wallet ? state.data : null;
  const busy =
    !!app.wallet && (state.wallet !== app.wallet || state.status === "loading");
  const error = state.wallet === app.wallet ? state.error : "";
  const setError = (message: string) =>
    setState((previous) => ({ ...previous, error: message }));
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
        <section className="lp-empty lp-wallet-empty" aria-busy={busy}>
          {busy ? (
            <LoaderCircle size={32} className="lp-spin" aria-hidden="true" />
          ) : (
            <Wallet size={32} />
          )}
          <h2>
            {busy
              ? "Loading your ones…"
              : !app.wallet
                ? "Connect your wallet"
                : state.status === "signin"
                  ? "Sign in to your wallet"
                  : "Couldn’t load your wallet"}
          </h2>
          {busy ? (
            <p role="status">Fetching your holdings and activity.</p>
          ) : (
            <>
              <p>
                {!app.wallet
                  ? "See your holdings, launches, and activity."
                  : state.status === "signin"
                    ? "Confirm ownership with a sign-in message. No transaction is sent."
                    : "Try loading your holdings again."}
              </p>
              <button
                className="lp-primary"
                onClick={() =>
                  !app.wallet
                    ? modal.setVisible(true)
                    : void load(state.status === "signin")
                }
              >
                {!app.wallet
                  ? "Connect wallet"
                  : state.status === "signin"
                    ? "Sign in"
                    : "Try again"}
                <ArrowUpRight size={17} />
              </button>
            </>
          )}
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
            <h2>Your launches</h2>
            {data.created.length ? (
              <div className="lp-launch-list">
                {data.created.map((token) => (
                  <Link key={token.id} href={`/app/token/${token.id}`}>
                    <span>
                      ${token.ticker} <PlatformBadge mint={token.mint} />{" "}
                      <small>{token.name}</small>
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
