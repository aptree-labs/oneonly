"use client";
import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, LoaderCircle, X } from "lucide-react";
import { formatNumber } from "@oneonly/core";
import type { SaleShare } from "@/lib/sale-pnl";
import {
  purchaseShareIntent,
  purchaseSharePath,
  type TradeShareSide,
} from "@/lib/purchase-share";

export function PurchaseShare({
  tokenId,
  ticker,
  side = "buy",
  saleId,
  onClose,
}: {
  tokenId: string;
  ticker?: string;
  side?: TradeShareSide;
  saleId?: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [sale, setSale] = useState<SaleShare | null>(null);
  const [saleError, setSaleError] = useState(false);
  const image = `${purchaseSharePath(tokenId)}/image`;
  const saleQuery =
    saleId && side === "sell" ? `&sale=${encodeURIComponent(saleId)}` : "";
  const preparingSale = !!saleQuery && (!sale || sale.status === "pending");
  useEffect(() => {
    if (!saleId || side !== "sell") return;
    let live = true,
      timer: ReturnType<typeof setTimeout>,
      attempts = 0;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(
          `/api/launchpad/sale-share/${encodeURIComponent(saleId)}?tokenId=${encodeURIComponent(tokenId)}`,
          {
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(20000),
            ]),
          },
        );
        if (!response.ok) throw new Error("Sale details unavailable");
        const next: SaleShare = await response.json();
        if (!live) return;
        setSale(next);
        setSaleError(false);
        if (next.status === "pending" && ++attempts < 40)
          timer = setTimeout(load, 5000);
      } catch {
        if (live) setSaleError(true);
      }
    };
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [saleId, tokenId, side, retry]);
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="lp-purchase-dialog"
      aria-labelledby="purchase-share-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      <button
        className="lp-close"
        aria-label={
          side === "sell" ? "Close sale share" : "Close purchase share"
        }
        onClick={onClose}
        autoFocus
      >
        <X size={20} aria-hidden="true" />
      </button>
      <span className="lp-kicker">
        {side === "sell" ? "SALE CONFIRMED" : "PURCHASE CONFIRMED"}
      </span>
      <h2 id="purchase-share-title">
        {side === "sell"
          ? `Sold${ticker ? ` $${ticker}` : ""}.`
          : `You’re in${ticker ? `, $${ticker}` : ""}.`}
      </h2>
      <div className="lp-purchase-art-wrap" aria-busy={!loaded && !failed}>
        <img
          className="lp-purchase-art"
          src={`${image}?side=${side}&v=2&retry=${retry}${sale && sale.status !== "pending" ? saleQuery : ""}`}
          alt={
            side === "sell"
              ? "One Only sell artwork"
              : ticker
                ? `$${ticker} in the puddle`
                : "Your token’s ticker in the puddle"
          }
          width={1200}
          height={1018}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          style={{ opacity: loaded ? 1 : 0 }}
        />
        {!loaded && (
          <div className="lp-purchase-loading" role="status">
            {failed ? (
              <>
                <span>Image couldn’t load.</span>
                <button
                  className="lp-secondary"
                  onClick={() => {
                    setFailed(false);
                    setRetry((value) => value + 1);
                  }}
                >
                  Retry image
                </button>
              </>
            ) : (
              <>
                <LoaderCircle size={22} className="lp-purchase-spinner" />
                <span>Making your share image…</span>
              </>
            )}
          </div>
        )}
      </div>
      {side === "sell" && saleId && (
        <section
          className="lp-sale-summary"
          aria-label="Your sale result"
          aria-live="polite"
        >
          {sale?.proceeds && (
            <div>
              <span>Pool proceeds</span>
              <strong>
                {formatNumber(sale.proceeds)} {sale.quote}
              </strong>
            </div>
          )}
          {sale?.status === "ready" ? (
            <>
              <div>
                <span>Cost of tokens sold</span>
                <strong>
                  {formatNumber(sale.costBasis)} {sale.quote}
                </strong>
              </div>
              <div>
                <span>Estimated P&amp;L</span>
                <strong
                  className={Number(sale.pnl) >= 0 ? "is-profit" : "is-loss"}
                >
                  {Number(sale.pnl) > 0 ? "+" : ""}
                  {formatNumber(sale.pnl)} {sale.quote}
                  {sale.percent !== null
                    ? ` (${sale.percent > 0 ? "+" : ""}${formatNumber(sale.percent)}%)`
                    : ""}
                </strong>
              </div>
            </>
          ) : (
            <p role="status">
              {saleError
                ? "Sale details couldn’t load."
                : (sale?.reason ?? "Calculating your sale…")}{" "}
              <button
                className="lp-text-link"
                onClick={() => setRetry((value) => value + 1)}
              >
                Refresh
              </button>
            </p>
          )}
          <small>
            Pool return · average cost · excludes network and routing fees.
          </small>
        </section>
      )}
      <div className="lp-purchase-actions">
        {preparingSale ? (
          <button className="lp-primary" disabled>
            {saleError
              ? "Refresh sale details to share"
              : "Preparing sale card…"}
          </button>
        ) : (
          <>
            <a
              className="lp-primary"
              href={purchaseShareIntent(tokenId, ticker, side, saleId)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Share on X <ExternalLink size={16} aria-hidden="true" />
            </a>
            <a
              className="lp-secondary"
              href={`${image}?download=1&side=${side}${saleQuery}`}
              download
            >
              Save image <Download size={16} aria-hidden="true" />
            </a>
          </>
        )}
      </div>
    </dialog>
  );
}
