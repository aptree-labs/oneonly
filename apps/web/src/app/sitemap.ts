import type { MetadataRoute } from "next";
import { site } from "@/lib/site";
import { isStaging } from "@/lib/deployment";
export default function sitemap(): MetadataRoute.Sitemap {
  if (isStaging()) return [];
  return [{ url: site.url, changeFrequency: "weekly", priority: 1 }];
}
