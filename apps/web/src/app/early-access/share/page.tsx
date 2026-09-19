import type { Metadata } from "next";
import { earlyAccessShare } from "@/lib/early-access-share";
import { EarlyAccessShareImage } from "@/components/early-access-share";

export const metadata: Metadata = {
  title: "Early Access",
  description: earlyAccessShare.text,
  alternates: { canonical: earlyAccessShare.url },
  openGraph: {
    type: "website",
    url: earlyAccessShare.url,
    siteName: "One Only",
    title: earlyAccessShare.text,
    description: "One Only. Early access is open.",
    images: [
      {
        url: earlyAccessShare.preview,
        width: 1200,
        height: 630,
        type: "image/jpeg",
        alt: earlyAccessShare.imageAlt,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: earlyAccessShare.text,
    description: "One Only. Early access is open.",
    images: [{ url: earlyAccessShare.preview, alt: earlyAccessShare.imageAlt }],
  },
};

export default function SharePage() {
  return (
    <main className="share-page">
      <article className="share-page-card">
        <p className="eyebrow">ONE ONLY · EARLY ACCESS</p>
        <EarlyAccessShareImage />
        <h1 className="share-page-heading">{earlyAccessShare.text}</h1>
        <a className="primary-button" href="/#early-access">
          Get on the list <span aria-hidden="true">↗</span>
        </a>
      </article>
    </main>
  );
}
