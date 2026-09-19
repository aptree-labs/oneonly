import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  outputFileTracingIncludes: {
    "/app/share/*/image": [
      "./public/brand/buy-share-v1.jpg",
      "./public/brand/sell-share-v1.jpg",
      "./public/brand/share-marker.woff",
    ],
  },
  transpilePackages: ["@oneonly/core", "@oneonly/db", "@oneonly/protocol"],
  serverExternalPackages: [
    "@electric-sql/pglite",
    "postgres",
    "@meteora-ag/dynamic-bonding-curve-sdk",
    "@coral-xyz/anchor",
  ],
  async rewrites() {
    return {
      // Keep the existing X app credentials and registered callback unchanged.
      beforeFiles:
        process.env.ONEONLY_SURFACE === "app"
          ? [
              {
                source: "/api/auth/x",
                destination: "https://oneonly-kappa.vercel.app/api/auth/x",
              },
              {
                source: "/api/auth/x/:path*",
                destination:
                  "https://oneonly-kappa.vercel.app/api/auth/x/:path*",
              },
            ]
          : [],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/scene/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};
export default config;
