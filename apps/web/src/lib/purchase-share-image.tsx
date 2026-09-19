import React from "react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { TradeShareSide } from "./purchase-share";
import type { SaleShare } from "./sale-pnl";
import { formatNumber } from "@oneonly/core";

// Keep the whole illustration visible in X's wider link-preview crop.
export async function purchaseShareImage(
  ticker: string,
  card = false,
  side: TradeShareSide = "buy",
  sale?: SaleShare,
) {
  const [art, font, bodyFont] = await Promise.all([
    readFile(
      path.join(
        process.cwd(),
        `public/brand/${side === "sell" ? "sell" : "buy"}-share-v1.jpg`,
      ),
    ),
    readFile(path.join(process.cwd(), "public/brand/share-marker.woff")),
    readFile(path.join(process.cwd(), "public/brand/share-body.woff")),
  ]);
  const height = card ? 630 : 1018;
  const artWidth = card ? 743 : 1200;
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: 1200,
        height,
        background: "#c7c7a6",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          position: "relative",
          width: artWidth,
          height,
        }}
      >
        <img
          src={`data:image/jpeg;base64,${art.toString("base64")}`}
          width={artWidth}
          height={height}
          alt=""
        />
        {side === "buy" && (
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: "36%",
              top: "79.8%",
              width: "57%",
              height: "7.5%",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "Marker",
              fontSize: artWidth * (ticker.length > 8 ? 0.047 : 0.06),
              color: "#606b3b",
              transform: "rotate(-4deg)",
            }}
          >
            ${ticker}
          </div>
        )}
      </div>
      {side === "sell" && sale && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            position: "absolute",
            right: card ? 35 : 50,
            top: card ? 40 : 60,
            width: card ? 535 : 610,
            padding: 32,
            border: "2px solid #8e9875",
            borderRadius: 22,
            background: "#e9ebd8",
            color: "#283123",
            fontFamily: "Body",
            gap: 17,
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: "Marker",
              fontSize: card ? 35 : 42,
            }}
          >
            SOLD ${ticker}
          </div>
          <div style={{ display: "flex", fontSize: 19, color: "#626f54" }}>
            ESTIMATED POOL P&amp;L
          </div>
          <div
            style={{
              display: "flex",
              fontSize: card ? 39 : 46,
              color: Number(sale.pnl) >= 0 ? "#466c31" : "#a33e32",
            }}
          >
            {sale.pnl === null
              ? "Not available"
              : `${Number(sale.pnl) > 0 ? "+" : ""}${formatNumber(sale.pnl)} ${sale.quote}`}
          </div>
          {sale.percent !== null && (
            <div style={{ display: "flex", fontSize: 28 }}>
              {sale.percent > 0 ? "+" : ""}
              {formatNumber(sale.percent)}%
            </div>
          )}
          {[
            [
              "Tokens sold",
              sale.quantity
                ? `${formatNumber(sale.quantity)} ${ticker}`
                : "Confirming…",
            ],
            [
              "Pool proceeds",
              sale.proceeds
                ? `${formatNumber(sale.proceeds)} ${sale.quote}`
                : "Confirming…",
            ],
            [
              "Cost of tokens sold",
              sale.costBasis !== null
                ? `${formatNumber(sale.costBasis)} ${sale.quote}`
                : "Unknown",
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 15,
                fontSize: 22,
              }}
            >
              <span>{label}</span>
              <span>{value}</span>
            </div>
          ))}
          <div style={{ display: "flex", fontSize: 17, color: "#626f54" }}>
            Average cost · excludes network / routing fees
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 18,
              paddingTop: 12,
              borderTop: "1px solid #a9b396",
            }}
          >
            <span>
              {sale.wallet.slice(0, 4)}…{sale.wallet.slice(-4)}
            </span>
            <span>ONEONLY.LOL</span>
          </div>
        </div>
      )}
    </div>,
    {
      width: 1200,
      height,
      fonts: [
        {
          name: "Body",
          data: bodyFont.buffer.slice(
            bodyFont.byteOffset,
            bodyFont.byteOffset + bodyFont.byteLength,
          ) as ArrayBuffer,
          weight: 700,
          style: "normal",
        },
        {
          name: "Marker",
          data: font.buffer.slice(
            font.byteOffset,
            font.byteOffset + font.byteLength,
          ) as ArrayBuffer,
          weight: 400,
          style: "normal",
        },
      ],
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" },
    },
  );
}
