import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // AI tailoring/scoring calls can run well past the proxy's default 30s timeout.
  experimental: { proxyTimeout: 180_000 },
  // Local dev: proxy /api/* to FastAPI. In AWS the ALB routes /api/* to the backend service
  // before it ever reaches Next.js, so this rewrite is only used by `next dev`.
  async rewrites() {
    const backend = process.env.BACKEND_URL ?? "http://localhost:8000";
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
