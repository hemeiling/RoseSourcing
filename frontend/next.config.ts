import type { NextConfig } from "next";

// Production: static export served by FastAPI (same origin, so /api works without CORS).
// Development: Next dev server proxies /api to the local FastAPI on :8000.
const isExport = process.env.NEXT_OUTPUT === "export";
const apiDev = process.env.API_DEV_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  turbopack: { root: process.cwd() },
  ...(isExport
    ? { output: "export" as const }
    : { rewrites: async () => [{ source: "/api/:path*", destination: `${apiDev}/api/:path*` }] }),
};

export default nextConfig;
