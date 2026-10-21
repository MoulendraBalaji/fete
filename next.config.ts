import type { NextConfig } from 'next';

/**
 * Security headers applied to every response.
 *
 * The CSP is deliberately strict: no third-party origins, no inline scripts of
 * our own, and `frame-ancestors 'none'` so the app cannot be framed for
 * clickjacking. Two allowances are required and intentional:
 *
 *  - `'unsafe-inline'` for styles: Next injects a small style block for its
 *    font and layout handling. Styles cannot exfiltrate data the way scripts can.
 *  - `'unsafe-inline'` for scripts is *not* granted. Next's pre-hydration theme
 *    snippet is served through `next/script`, which this app configures to be
 *    hashed at build time; if a future change introduces a raw inline script,
 *    the CSP will block it rather than silently permit it.
 *
 * `connect-src 'self'` is sufficient because all LLM traffic happens
 * server-side: the browser never talks to the model provider.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
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
