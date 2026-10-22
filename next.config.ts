import type { NextConfig } from 'next';

/**
 * Security headers applied to every response.
 *
 * NOTE: `Content-Security-Policy` is *not* here. It carries a per-request nonce
 * and is therefore built in `middleware.ts`, which also sets it on the
 * forwarded request so Next can stamp the nonce onto its inline scripts. A
 * static CSP in this file would have to grant `'unsafe-inline'` to work at all,
 * which is exactly what the nonce removes. See `lib/security/csp.ts`.
 *
 * The headers below are value-independent, so they belong here: Vercel applies
 * them at the CDN edge for every route, including the static assets that the
 * middleware deliberately skips.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Stops another origin embedding our responses as a subresource (a
  // speculative-execution side channel). `same-origin` rather than
  // `same-site`: nothing here is meant to be embedded anywhere.
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The app is a single deployable; nothing here needs remote images or rewrites.
  images: { unoptimized: true },
  /**
   * Pin the workspace root to this project.
   *
   * Next infers the root by walking up for a lockfile. On a machine where a
   * `package-lock.json` exists in a parent directory (a home folder, a monorepo
   * checkout) that inference picks the parent, which then ignores this project's
   * `tsconfig.json` — and with it the `@/*` path alias, breaking resolution.
   * Declaring the root removes the ambiguity entirely.
   */
  outputFileTracingRoot: __dirname,
  async headers() {
    return [
      {
        // Every route, including the API handlers.
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
