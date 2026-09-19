import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { tokenById } from "@/lib/launchpad/transactions";
import { tradeShareUrl, purchaseSharePath } from "@/lib/purchase-share";
const getToken = cache(tokenById);
type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ side?: string; sale?: string }>;
};
export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const token = await getToken((await params).id);
  const side = (await searchParams).side === "sell" ? "sell" : "buy";
  const saleId = side === "sell" ? (await searchParams).sale : undefined;
  const url = tradeShareUrl(token.id, side, saleId);
  const title = `$${token.ticker}${side === "sell" ? " — Sold" : ""} — One Only`;
  const description = `Find $${token.ticker} on One Only.`;
  const image = {
    url: `${tradeShareUrl(token.id)}/image?card=1&side=${side}${saleId ? `&sale=${encodeURIComponent(saleId)}` : ""}`,
    width: 1200,
    height: 630,
    alt:
      side === "sell"
        ? `One Only sell artwork for $${token.ticker}`
        : `$${token.ticker} in the One Only puddle`,
  };
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", title, description, url, images: [image] },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
export default async function Page({ params, searchParams }: Props) {
  const token = await getToken((await params).id);
  const side = (await searchParams).side === "sell" ? "sell" : "buy";
  const saleId = side === "sell" ? (await searchParams).sale : undefined;
  return (
    <section className="lp-panel lp-purchase-page">
      <span className="lp-kicker">ONE ONLY</span>
      <h1>${token.ticker}</h1>
      <img
        className="lp-purchase-art"
        src={`${purchaseSharePath(token.id)}/image?side=${side}${saleId ? `&sale=${encodeURIComponent(saleId)}` : ""}`}
        alt={
          side === "sell"
            ? `One Only sell artwork for $${token.ticker}`
            : `$${token.ticker} in the puddle`
        }
        width={1200}
        height={1018}
      />
      <Link className="lp-primary" href={`/app/token/${token.id}`}>
        Trade ${token.ticker}
      </Link>
    </section>
  );
}
