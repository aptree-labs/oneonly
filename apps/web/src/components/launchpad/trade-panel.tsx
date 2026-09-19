"use client";
import { PlatformBadge } from "./platform-token";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowDownUp, LoaderCircle, RefreshCw } from "lucide-react";
import {
  normalizeAmount,
  percentageAmount,
  formatExactAmount,
} from "@oneonly/core";
import { api, number, useLaunchpad, type Intent } from "./provider";
import type { Token } from "./explore";
import { Select } from "./select";
import { UsdValue } from "./usd-value";
import { TradePreview } from "./trade-preview";
type Asset = {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  balance: string | null;
  usd?: number | null;
};
type Assets = {
  wallet: string | null;
  tokenBalance: string | null;
  assets: Asset[];
};
export function TradePanel({ token }: { token: Token }) {
  const app = useLaunchpad();
  const [side, setSide] = useState<"buy" | "sell">("buy"),
    [settlement, setSettlement] = useState(token.quote),
    [amount, setAmount] = useState(""),
    [slippage, setSlippage] = useState("1"),
    [assets, setAssets] = useState<Assets | null>(null),
    [balanceError, setBalanceError] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (app.lastConfirmedTrade?.tokenId !== token.id) return;
    setAmount("");
    setError("");
  }, [app.lastConfirmedTrade?.id, token.id]);
  useEffect(() => {
    let live = true,
      loading = false;
    setAssets(null);
    setBalanceError("");
    const load = async () => {
      if (loading || document.hidden) return;
      loading = true;
      try {
        const result = await api<Assets>(
          `trade-assets/${token.id}${app.wallet ? `?wallet=${encodeURIComponent(app.wallet)}` : ""}`,
        );
        if (live) {
          setAssets(result);
          setBalanceError("");
        }
      } catch {
        if (live) {
          setAssets((current) =>
            current
              ? {
                  ...current,
                  wallet: null,
                  tokenBalance: null,
                  assets: current.assets.map((asset) => ({
                    ...asset,
                    balance: null,
                  })),
                }
              : null,
          );
          setBalanceError("Balance unavailable.");
        }
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [token.id, app.wallet, revision, app.transactionRevision]);
  const choices: Asset[] = assets?.assets?.length
    ? assets.assets
    : [
        ...new Set([
          token.quote,
          app.network === "mainnet-beta" ? "SOL" : token.quote,
          settlement,
        ]),
      ].map((symbol) => ({
        symbol,
        name: symbol,
        mint: "",
        decimals:
          symbol === "SOL"
            ? 9
            : symbol === token.quote && "quoteDecimals" in token
              ? Number(token.quoteDecimals)
              : 6,
        balance: null,
      }));
  const selected = choices.find((asset) => asset.symbol === settlement);
  const payment = settlement;
  const ownBalances = assets?.wallet === app.wallet && !!app.wallet;
  const inputBalance = ownBalances
    ? side === "buy"
      ? (selected?.balance ?? null)
      : assets.tokenBalance
    : null;
  const outputBalance = ownBalances
    ? side === "buy"
      ? assets.tokenBalance
      : (selected?.balance ?? null)
    : null;
  const changeSide = (value: "buy" | "sell") => {
    setSide(value);
    setAmount("");
    setError("");
  };
  const chooseAsset = (value: string) => {
    setSettlement(value);
    setAmount("");
    setError("");
  };
  const fillPercentage = (percent: number) => {
    if (inputBalance === null) return;
    try {
      setAmount(
        percentageAmount(
          inputBalance,
          percent,
          side === "sell" ? 6 : (selected?.decimals ?? 9),
          side === "buy" && payment === "SOL" ? "0.01" : "0",
        ),
      );
      setError("");
    } catch {
      setError("Refresh your balance before using a percentage.");
    }
  };
  async function review(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const normalized = normalizeAmount(amount);
      await app.authenticate();
      const intent = await api<Intent>("trade", {
        tokenId: token.id,
        side,
        amount: normalized,
        settlement: payment,
        slippageBps: Number(slippage) * 100,
      });
      await app.executeTrade(intent);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selector = (label: string) => (
    <Select
      label={label}
      value={payment}
      disabled={busy}
      searchable
      onChange={chooseAsset}
      options={[
        ...(!selected
          ? [
              {
                value: payment,
                label: payment,
                description: "Unavailable",
                disabled: true,
              },
            ]
          : []),
        ...choices.map((asset) => ({
          value: asset.symbol,
          label: asset.symbol,
          description: asset.name,
          meta:
            ownBalances && asset.balance !== null
              ? number(asset.balance)
              : undefined,
        })),
      ]}
    />
  );
  const balance = (value: string) => `${number(value)} available`;
  return (
    <form className="lp-panel lp-trade-form lp-swap-panel" onSubmit={review}>
      <div className="lp-swap-heading">
        <img src={`/api/launchpad/image/${token.imageId}`} alt="" />
        <div>
          <strong>
            {token.name} <PlatformBadge mint={token.mint} />
          </strong>
          <span>${token.ticker}</span>
        </div>
      </div>
      <div className="lp-tabs lp-trade-tabs">
        {(["buy", "sell"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={side === value}
            disabled={busy}
            onClick={() => changeSide(value)}
          >
            {value === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>
      <div className="lp-swap-asset">
        <label htmlFor={`trade-amount-${token.id}`}>
          {side === "buy" ? "You pay" : "You sell"}
        </label>
        <div className="lp-amount-input">
          <input
            id={`trade-amount-${token.id}`}
            aria-label={side === "buy" ? "You pay" : "You sell"}
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setError("");
            }}
            inputMode="decimal"
            placeholder="0"
            required
            disabled={busy}
          />
        </div>
        <span className="lp-swap-usd" aria-label="Payment value in USD">
          <UsdValue
            value={(() => {
              const price = side === "buy" ? selected?.usd : token.priceUsd;
              try {
                return price == null
                  ? null
                  : price * Number(normalizeAmount(amount || "0"));
              } catch {
                return null;
              }
            })()}
          />
        </span>
        <div className="lp-swap-asset-footer">
          {side === "buy" ? (
            selector("Pay with")
          ) : (
            <span className="lp-swap-token">{token.ticker}</span>
          )}
          {inputBalance !== null && (
            <span title={formatExactAmount(inputBalance)}>
              {balance(inputBalance)}
            </span>
          )}
          {inputBalance !== null && (
            <button
              type="button"
              className="lp-swap-max"
              disabled={busy || app.tradePending || inputBalance === null}
              onClick={() => fillPercentage(100)}
            >
              Max
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        className="lp-swap-reverse"
        aria-label="Reverse trade direction"
        disabled={busy}
        onClick={() => changeSide(side === "buy" ? "sell" : "buy")}
      >
        <ArrowDownUp size={18} />
      </button>
      <div className="lp-swap-asset lp-swap-output">
        <span>You receive</span>
        <TradePreview
          tokenId={token.id}
          side={side}
          settlement={payment}
          amount={amount}
          slippageBps={Number(slippage) * 100}
          paused={busy}
          usdPrice={side === "buy" ? token.priceUsd : selected?.usd}
        />
        <div className="lp-swap-asset-footer">
          {side === "sell" ? (
            selector("Receive")
          ) : (
            <span className="lp-swap-token">{token.ticker}</span>
          )}
          {outputBalance !== null && (
            <span title={formatExactAmount(outputBalance)}>
              {balance(outputBalance)}
            </span>
          )}
        </div>
      </div>
      {inputBalance !== null && (
        <div
          className="lp-swap-percentages"
          role="group"
          aria-label="Percentage of available balance"
        >
          {[25, 50, 75, 100].map((percent) => (
            <button
              type="button"
              key={percent}
              disabled={busy || app.tradePending || inputBalance === null}
              onClick={() => fillPercentage(percent)}
            >
              {percent}%
            </button>
          ))}
        </div>
      )}
      <div className="lp-swap-settings">
        <label>
          Slippage
          <Select
            label="Slippage"
            value={slippage}
            disabled={busy}
            onChange={setSlippage}
            options={["0.5", "1", "3", "5"].map((value) => ({
              value,
              label: `${value}%`,
            }))}
          />
        </label>
        <button
          type="button"
          className="lp-text-link"
          aria-label="Refresh balances"
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {app.wallet && balanceError && (
        <p className="lp-caption">{balanceError}</p>
      )}
      {payment === token.quote && !token.snapshot?.graduated && (
        <p className="lp-caption">1.25% trading fee</p>
      )}
      {token.snapshot?.readyToMigrate ? (
        <p className="lp-notice">Graduation required to resume trading.</p>
      ) : (
        <button
          className="lp-primary lp-full"
          disabled={
            busy ||
            app.tradePending ||
            !selected ||
            !["active", "released"].includes(token.status)
          }
        >
          {busy && <LoaderCircle size={18} className="lp-spin" />}
          {busy
            ? "Preparing trade…"
            : app.tradePending
              ? "Trade pending…"
              : `${side === "buy" ? "Buy" : "Sell"} ${token.ticker}`}
        </button>
      )}
      {error && (
        <p className="lp-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
