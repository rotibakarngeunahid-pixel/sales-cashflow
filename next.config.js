/** @type {import('next').NextConfig} */
const nextConfig = {
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

module.exports = nextConfig;
