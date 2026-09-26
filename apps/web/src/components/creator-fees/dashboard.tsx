"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { feeApi, useFeeStatus, type FeeProfile } from "./client";
import { FeeIdentity } from "./profile";
import { useLaunchpad, type Intent } from "../launchpad/provider";
import "./creator-fees.css";
type Balance = {
  mint: string;
  symbol: string;
  amountAtomic: string;
  decimals: number;
  pendingAtomic?: string;
  pendingVenue?: "dbc" | "damm-v2";
};
type Allocation = {
  tokenId: string;
  ticker: string;
  name: string;
  shareBps: number;
  balances: Balance[];
  balanceStatus: string;
};
type Account = {
  wallet?: string;
  profile: FeeProfile | null;
  binding?: unknown;
  allocations: Allocation[];
  hasMore?: boolean;
};
type Challenge = {
  id: string;
  postText: string;
  composeUrl: string;
  expiresAt: string | number;
  status: string;
};
export function CreatorFees({ recipient }: { recipient?: string }) {
  const app = useLaunchpad();
  const { status, devnet, error: statusError } = useFeeStatus();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const lastTransaction = useRef(app.transactionRevision);
  useEffect(() => {
    if (lastTransaction.current === app.transactionRevision) return;
    lastTransaction.current = app.transactionRevision;
    if (recipient) setRevision((value) => value + 1);
    else if (account) void loadMine();
  }, [app.transactionRevision]);
  useEffect(() => {
    setAccount(null);
    setError("");
    if (!status?.enabled || !recipient) return;
    const controller = new AbortController();
    setLoading(true);
    feeApi<Account>(
      `recipients/${encodeURIComponent(recipient)}`,
      undefined,
      controller.signal,
    )
      .then(setAccount)
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [recipient, status?.enabled, revision]);
  // A wallet change invalidates every private balance and claim shown here.
  useEffect(() => {
    if (recipient) return;
    setAccount(null);
    if (!app.wallet || !status?.enabled) return;
    const controller = new AbortController();
    // Reuse an existing signed session without opening the wallet on page load.
    feeApi<Account>("me", undefined, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted && result.wallet === app.wallet)
          setAccount(result);
      })
      .catch(() => {
        /* Connect & view fees can establish a new session. */
      });
    return () => controller.abort();
  }, [app.wallet, recipient, status?.enabled]);
  async function loadMine() {
    setLoading(true);
    setError("");
    try {
      await app.authenticate();
      setAccount(await feeApi<Account>("me"));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function loadMore() {
    if (!account || loading) return;
    setLoading(true);
    setError("");
    try {
      if (!recipient) await app.authenticate();
      const next = await feeApi<Account>(
        `${recipient ? `recipients/${encodeURIComponent(recipient)}` : "me"}?offset=${account.allocations.length}`,
      );
      setAccount((previous) =>
        previous
          ? {
              ...next,
              allocations: [
                ...previous.allocations,
                ...next.allocations.filter(
                  (row) =>
                    !previous.allocations.some(
                      (item) => item.tokenId === row.tokenId,
                    ),
                ),
              ],
            }
          : next,
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function bind() {
    setLoading(true);
    setError("");
    try {
      await app.authenticate();
      await feeApi("bind", {});
      setAccount(await feeApi<Account>("me"));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="cf-dashboard">
      <header className="lp-page-heading">
        <span className="lp-kicker">CREATOR FEES · DEVNET</span>
        <h1>
          Your share.
          <br />
          <em>Your call.</em>
        </h1>
        <p>Fees allocated to an X account, ready for its owner to claim.</p>
      </header>
      {!devnet ? (
        <p className="lp-notice">
          Creator fee sharing is available on staging only.
        </p>
      ) : statusError ? (
        <p className="lp-error" role="alert">
          {statusError}
        </p>
      ) : !status ? (
        <p className="cf-muted">
          <LoaderCircle size={18} className="lp-spin" /> Loading creator fees…
        </p>
      ) : !status.enabled ? (
        <p className="lp-notice">
          Creator fee sharing is not enabled in this environment.
        </p>
      ) : (
        <>
          <div className="cf-section-heading">
            {account?.profile ? (
              <FeeIdentity profile={account.profile} />
            ) : (
              <h2>{recipient ? "Fee recipient" : "My creator fees"}</h2>
            )}
            {recipient ? (
              <Link className="lp-secondary" href="/app/creator-fees">
                My fees
              </Link>
            ) : (
              <button
                className="lp-secondary"
                disabled={loading}
                onClick={() => void loadMine()}
              >
                {loading ? (
                  <LoaderCircle size={16} className="lp-spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                {account ? "Refresh" : "Connect & view fees"}
              </button>
            )}
          </div>
          {error && (
            <p className="lp-error" role="alert">
              {error}
            </p>
          )}
          {!status.escrowAvailable && (
            <p className="lp-notice">
              Fee claims are not available yet. Allocations appear here once a
              shared-fee token launches.
            </p>
          )}
          {!recipient && account && !account.profile && (
            <p className="lp-notice">
              Connect X in the top bar, then refresh to find your allocations.
            </p>
          )}
          {!recipient && account?.profile && !account.binding && (
            <div className="lp-panel cf-bind">
              <div>
                <h2>Link your claim wallet</h2>
                <p className="lp-caption">
                  Use your verified X account and connected wallet to claim your
                  share.
                </p>
              </div>
              <button
                className="lp-primary"
                disabled={loading}
                onClick={() => void bind()}
              >
                Link wallet
              </button>
            </div>
          )}
          {loading && (
            <p className="cf-muted" role="status">
              <LoaderCircle size={18} className="lp-spin" /> Loading
              allocations…
            </p>
          )}
          {account && !loading && account.allocations.length === 0 && (
            <div className="lp-panel cf-empty">
              <h2>No allocations yet</h2>
              <p>
                Tokens that share creator fees with{" "}
                {account.profile
                  ? `@${account.profile.username}`
                  : "your X account"}{" "}
                will appear here.
              </p>
              <Link className="lp-secondary" href="/app/leaderboard">
                Explore recipients <ArrowUpRight size={16} />
              </Link>
            </div>
          )}
          {account?.allocations.map((allocation) => (
            <article className="lp-panel cf-token" key={allocation.tokenId}>
              <div className="cf-section-heading">
                <Link href={`/app/token/${allocation.tokenId}`}>
                  <h2>${allocation.ticker}</h2>
                  <span className="lp-caption">{allocation.name}</span>
                </Link>
                <strong className="cf-share-badge">
                  {allocation.shareBps / 100}% creator share
                </strong>
              </div>
              {allocation.balanceStatus !== "available" ? (
                <p className="cf-muted">Unclaimed fees unavailable</p>
              ) : allocation.balances.length === 0 ? (
                <p className="cf-muted">No fees available to claim.</p>
              ) : (
                allocation.balances.map((balance) => (
                  <div key={balance.mint} className="cf-balance">
                    <small className="lp-caption">Ready to claim</small>
                    <span>
                      {(
                        Number(balance.amountAtomic) /
                        10 ** balance.decimals
                      ).toLocaleString("en-US", {
                        maximumFractionDigits: Math.min(balance.decimals, 9),
                      })}{" "}
                      {balance.symbol}
                    </span>
                    {recipient &&
                      balance.pendingAtomic &&
                      BigInt(balance.pendingAtomic) > 0n && (
                        <p className="lp-caption">
                          {(
                            Number(balance.pendingAtomic) /
                            10 ** balance.decimals
                          ).toLocaleString("en-US", {
                            maximumFractionDigits: Math.min(
                              balance.decimals,
                              9,
                            ),
                          })}{" "}
                          {balance.symbol} awaiting collection · estimated
                        </p>
                      )}
                    {!recipient && !!account.binding && (
                      <ClaimFlow
                        key={`${app.wallet}:${app.transactionRevision}:${allocation.tokenId}:${balance.mint}`}
                        allocation={allocation}
                        balance={balance}
                        enabled={status.escrowAvailable}
                      />
                    )}
                  </div>
                ))
              )}
            </article>
          ))}
          {account?.hasMore && (
            <button
              className="lp-secondary"
              disabled={loading}
              onClick={() => void loadMore()}
            >
              {loading ? "Loading…" : "Load more tokens"}
            </button>
          )}
          {recipient && error && (
            <button
              className="lp-secondary"
              onClick={() => setRevision((value) => value + 1)}
            >
              Retry
            </button>
          )}
        </>
      )}
    </div>
  );
}
function ClaimFlow({
  allocation,
  balance,
  enabled,
}: {
  allocation: Allocation;
  balance: Balance;
  enabled: boolean;
}) {
  const app = useLaunchpad();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [tweetUrl, setTweetUrl] = useState("");
  const [verified, setVerified] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pending =
    /^[0-9]+$/.test(balance.pendingAtomic ?? "") &&
    BigInt(balance.pendingAtomic!) > 0n;
  useEffect(() => {
    if (!challenge) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [challenge]);
  const expires = challenge
    ? typeof challenge.expiresAt === "number"
      ? challenge.expiresAt
      : Date.parse(challenge.expiresAt)
    : 0;
  const expired = !!challenge && (!Number.isFinite(expires) || expires <= now);
  async function run(action: "start" | "verify" | "claim" | "collect") {
    setBusy(action);
    setError("");
    try {
      await app.authenticate();
      if (action === "collect") {
        const intent = await feeApi<Intent>("collect", {
          tokenId: allocation.tokenId,
          venue: balance.pendingVenue,
        });
        app.review(intent);
      } else if (action === "start") {
        setVerified(false);
        setReady(false);
        setTweetUrl("");
        setCopied(false);
        setChallenge(
          await feeApi<Challenge>("challenges", {
            tokenId: allocation.tokenId,
            mint: balance.mint,
            amountAtomic: balance.amountAtomic,
          }),
        );
      } else if (action === "verify") {
        const result = await feeApi<{ verified: boolean; claimReady: boolean }>(
          "verify",
          { challengeId: challenge!.id, tweetUrl },
        );
        setVerified(result.verified);
        setReady(result.claimReady);
      } else {
        const intent = await feeApi<Intent>("claim", {
          challengeId: challenge!.id,
        });
        app.review(intent);
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(challenge!.postText);
      setCopied(true);
    } catch {
      setError("Select and copy the post text below.");
    }
  }
  let composeUrl: string | null = null;
  try {
    const url = new URL(challenge?.composeUrl || "");
    if (
      url.protocol === "https:" &&
      ["x.com", "twitter.com"].includes(url.hostname)
    )
      composeUrl = url.href;
  } catch {
    /* no active challenge */
  }
  return (
    <div className="cf-claim">
      {pending && (
        <div className="cf-prepare">
          <div>
            <strong>
              {(
                Number(balance.pendingAtomic) /
                10 ** balance.decimals
              ).toLocaleString("en-US", {
                maximumFractionDigits: Math.min(balance.decimals, 9),
              })}{" "}
              {balance.symbol}
            </strong>
            <p className="lp-caption">Awaiting collection · estimated share</p>
          </div>
          <button
            className="lp-secondary"
            disabled={!enabled || !!busy || !balance.pendingVenue}
            onClick={() => void run("collect")}
          >
            {busy === "collect" ? "Preparing…" : "Prepare fees"}
          </button>
          <p className="lp-caption">
            Move fees into the shared vault before claiming.
          </p>
        </div>
      )}

      {!challenge ? (
        <button
          className="lp-primary"
          disabled={
            !enabled ||
            !!busy ||
            !/^[0-9]+$/.test(balance.amountAtomic) ||
            BigInt(balance.amountAtomic) === 0n
          }
          onClick={() => void run("start")}
        >
          {busy ? "Preparing…" : "Claim fees"}
        </button>
      ) : (
        <>
          <ol className="cf-steps">
            <li className={verified ? "is-done" : "is-active"}>Post on X</li>
            <li className={verified ? "is-done" : ""}>Verify post</li>
            <li className={verified && ready ? "is-active" : ""}>Claim fees</li>
          </ol>
          <textarea
            readOnly
            value={challenge.postText}
            rows={3}
            aria-label="Your claim post"
          />
          <div className="cf-actions">
            <button className="lp-secondary" onClick={() => void copy()}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copied" : "Copy post"}
            </button>
            {composeUrl && !expired && (
              <a
                className="lp-primary"
                target="_blank"
                rel="noopener noreferrer"
                href={composeUrl}
              >
                Post on X <ArrowUpRight size={16} />
              </a>
            )}
          </div>
          {expired ? (
            <div className="lp-notice">
              This post request expired.{" "}
              <button
                className="cf-text-button"
                disabled={!!busy}
                onClick={() => void run("start")}
              >
                Create a new post
              </button>
            </div>
          ) : (
            <>
              <label>
                Post link
                <input
                  inputMode="url"
                  placeholder="https://x.com/you/status/…"
                  value={tweetUrl}
                  disabled={verified}
                  onChange={(event) => setTweetUrl(event.target.value)}
                />
              </label>
              {!verified ? (
                <button
                  className="lp-secondary"
                  disabled={!!busy || !tweetUrl.trim()}
                  onClick={() => void run("verify")}
                >
                  {busy === "verify" ? (
                    <LoaderCircle size={16} className="lp-spin" />
                  ) : null}
                  {busy === "verify" ? "Checking your post…" : "Verify post"}
                </button>
              ) : (
                <>
                  <p className="lp-valid">
                    <Check size={16} /> Post verified
                  </p>
                  <button
                    className="lp-primary"
                    disabled={!ready || !!busy}
                    onClick={() => void run("claim")}
                  >
                    {busy === "claim"
                      ? "Preparing claim…"
                      : ready
                        ? "Review claim"
                        : "Claiming not available yet"}
                  </button>
                </>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <p className="lp-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
