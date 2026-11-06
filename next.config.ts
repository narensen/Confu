import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  // Loaded by Node at runtime rather than bundled (it picks its platform build itself).
  serverExternalPackages: ["youtubei.js"],
  // Documents became sessions; existing documents kept their id as the session id.
  async redirects() {
    return [{ source: "/doc/:id", destination: "/session/:id", permanent: false }];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
