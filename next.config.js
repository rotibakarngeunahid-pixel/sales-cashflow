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
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        stream: false,
        path: false,
        zlib: false,
        crypto: false,
        net: false,
        tls: false,
      }
    }
    return config
  },
};

module.exports = nextConfig;
