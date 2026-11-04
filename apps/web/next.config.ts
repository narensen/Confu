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
    // SQLite's package also ships a helper worker (sqlite3-worker1) whose
    // legacy "opfs" storage builds a worker URL at runtime, which can't be
    // resolved at build time. Confu never starts that worker: it runs SQLite
    // in its own (packages/storage/src/drivers/wasm-worker.ts).
    ignoreIssue: [{ path: /@sqlite\.org\/sqlite-wasm\/dist\/sqlite3-worker1\.mjs$/, title: /Module not found/ }],
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
