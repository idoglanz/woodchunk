import type { NextConfig } from "next";

// The app is a client-rendered SPA over the FastAPI backend (no server data fetching),
// so Cache Components / partial prefetching would only add prerender constraints.
const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
