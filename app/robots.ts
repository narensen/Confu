import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard", "/session/", "/settings", "/review", "/admin", "/welcome", "/rooms", "/wrapped"] },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
