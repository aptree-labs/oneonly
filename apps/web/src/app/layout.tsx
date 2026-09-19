import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { site } from "@/lib/site";
import "@fontsource/permanent-marker/latin-400.css";
import "@fontsource/space-grotesk/latin-400.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-700.css";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.title, template: "%s — One Only" },
  description: site.description,
  applicationName: site.name,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: site.name,
    title: site.title,
    description: site.description,
    images: [
      {
        url: site.image,
        width: 1200,
        height: 630,
        type: "image/jpeg",
        alt: site.imageAlt,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: site.title,
    description: site.description,
    images: [{ url: site.image, alt: site.imageAlt }],
  },
  robots: { index: true, follow: true, "max-image-preview": "large" },
  appleWebApp: { title: site.name, capable: true, statusBarStyle: "default" },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = {
  themeColor: "#b6d1c5",
  width: "device-width",
  initialScale: 1,
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
