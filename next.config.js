/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'owner-portal.rotibakarngeunah.my.id',
      },
    ],
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
