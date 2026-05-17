import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    domains: [],
  },
  experimental: {
    serverActions: {
      allowedOrigins: [
        "localhost:3000",
        "rbn-sales-cashflow.vercel.app",
      ],
    },
  },
};

export default nextConfig;
