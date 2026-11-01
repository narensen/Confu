import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard", "/session/", "/doc", "/settings", "/reset-password", "/review", "/admin", "/welcome", "/rooms", "/friends", "/threads", "/spaces", "/wrapped", "/map"] },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
