import type { MetadataRoute } from "next";

// Installable app (desktop and Android; iPhone via Share → Add to Home Screen).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Confu",
    short_name: "Confu",
    description: "Learn anything deeply: study, exam prep and research papers, with a tutor that remembers.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f6f6f3",
    theme_color: "#0d0d0c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Review", url: "/review" },
      { name: "Library", url: "/dashboard" },
    ],
  };
}
