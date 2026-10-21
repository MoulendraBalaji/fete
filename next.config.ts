import type { NextConfig } from 'next';

/**
 * Security headers applied to every response.
 *
 * ── Why `script-src` allows `'unsafe-inline'` ──────────────────────────────
 *
 * This was originally `script-src 'self'`, which **broke the app**: React never
 * hydrated and the page sat on its server-rendered loading state forever. The
 * cause is that Next.js emits several inline `<script>` blocks as part of normal
 * operation — the App Router's streamed flight payload, the bootstrap that
 * replaces suspense placeholders, and this app's own pre-paint theme snippet via
 * `next/script`. A bare `'self'` blocks all of them, and a hydration failure is
 * silent from the server's point of view: the HTML is valid, it just never comes
 * alive on the client.
 *
 * The honest framing: `next/script` does **not** hash or nonce its output, so
 * there is no way to keep inline scripts working without either granting
 * `'unsafe-inline'` or adopting a nonce-based CSP (which requires middleware to
 * generate a per-request nonce and thread it through `next/script`). The
 * nonce route is the stronger option and the documented upgrade path; it is not
 * taken here because it adds a middleware hop to every request for a single-page
 * app whose only inline script is our own four-line theme bootstrap.
 *
 * What still holds, and is what actually blunts XSS:
 *  - `'unsafe-eval'` is **not** granted in production, so a string cannot be
 *    evaluated as code.
 *  - `default-src 'self'` means no inline or remote script can pull in a
 *    third-party payload, and there is no `dangerouslySetInnerHTML` anywhere in
 *    the app, so user text is never a script source in the first place.
 *  - `connect-src 'self'` keeps exfiltration in check: injected script could run,
 *    but it has nowhere off-origin to send what it reads.
 *
 * ── Why development and production differ ─────────────────────────────────
 *
 * `next dev` compiles with webpack's eval-based HMR and the React Refresh
 * runtime, both of which legitimately require `'unsafe-eval'`. Granting it only
 * in development keeps the production policy as tight as Next allows.
 */
const isDev = process.env.NODE_ENV !== 'production';

const scriptSrc = ["'self'", "'unsafe-inline'", isDev ? "'unsafe-eval'" : undefined]
  .filter(Boolean)
  .join(' ');

const CSP = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  // All LLM traffic is server-side, so the browser never talks to a provider.
  // In development Next's HMR socket needs `ws:`.
  isDev ? "connect-src 'self' ws: http://localhost:*" : "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  isDev ? undefined : 'upgrade-insecure-requests',
]
  .filter(Boolean)
  .join('; ');

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
