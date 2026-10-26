import type { NextConfig } from "next";

// The app is a client-rendered SPA over the FastAPI backend (no server data fetching),
// so Cache Components / partial prefetching would only add prerender constraints.
const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // The Workshop page is now Inventory: old links and bookmarks still land there.
  async redirects() {
    return [{ source: "/workshop", destination: "/inventory", permanent: true }];
  },
};

export default nextConfig;
