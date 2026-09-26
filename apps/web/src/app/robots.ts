import type { MetadataRoute } from "next";
import { site } from "@/lib/site";
import { isStaging } from "@/lib/deployment";
export default function robots(): MetadataRoute.Robots {
  if (isStaging()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
