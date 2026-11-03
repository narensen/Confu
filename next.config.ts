import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  // Loaded by Node at runtime rather than bundled (it picks its platform build itself).
  serverExternalPackages: ["youtubei.js"],
  async redirects() {
    return [
      // Documents became sessions; existing documents kept their id as the session id.
      { source: "/doc/:id", destination: "/session/:id", permanent: false },
      // There are no plans any more: everyone brings their own AI.
      { source: "/pricing", destination: "/#ai", permanent: true },
    ];
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
