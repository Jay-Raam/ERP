import type { NextConfig } from 'next';

// Read when the app is built or the dev server starts.
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @erp/shared ships TypeScript source; Next compiles it with the app.
  transpilePackages: ['@erp/shared'],
  /**
   * The browser only ever talks to this origin; API paths are forwarded.
   * That keeps session cookies first-party and needs no CORS. Behind the
   * production load balancer the same paths are routed straight to the API.
   */
  async rewrites() {
    return [
      { source: '/graphql', destination: `${API_URL}/graphql` },
      { source: '/auth/:path*', destination: `${API_URL}/auth/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
