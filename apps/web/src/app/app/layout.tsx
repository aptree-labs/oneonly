import { NETWORK } from "@oneonly/protocol";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { LaunchpadProvider } from "@/components/launchpad/provider";
import "./launchpad.css";
export const metadata: Metadata = {
  title: "Explore",
  metadataBase: new URL("https://app.oneonly.lol"),
  alternates: { canonical: "https://app.oneonly.lol" },
  robots: { index: false, follow: false },
  description:
    "Discover, launch and trade tokens on One Only. Powered by Meteora on Solana.",
  twitter: {
    card: "summary_large_image",
    title: "One Only — Launch & trade",
    description:
      "Discover, launch and trade tokens on One Only. Powered by Meteora on Solana.",
    images: ["https://app.oneonly.lol/brand/oneonly-app-social-v2.jpg"],
  },
  openGraph: {
    images: [
      {
        url: "https://app.oneonly.lol/brand/oneonly-app-social-v2.jpg",
        width: 1200,
        height: 630,
        alt: "One Only — launch and trade",
      },
    ],
    title: "One Only — Launch & trade",
    url: "https://app.oneonly.lol",
    description:
      "Discover, launch and trade tokens on One Only. Powered by Meteora on Solana.",
  },
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme =
    (await cookies()).get("oneonly-theme")?.value === "light"
      ? "light"
      : "dark";
  return (
    <LaunchpadProvider network={NETWORK} initialTheme={theme}>
      {children}
    </LaunchpadProvider>
  );
}
