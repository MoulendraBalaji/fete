/**
 * Per-request CSP nonce.
 *
 * Why middleware: a nonce must be unique per response, so it can only be minted
 * once the request exists. This runs on the Edge before the App Router renders,
 * which is the only point where the value can be attached to both the request
 * (so React emits it on its inline scripts) and the response (so the browser
 * enforces it).
 *
 * ── The header name is not a free choice ────────────────────────────────────
 *
 * Next parses the nonce out of the request's **`Content-Security-Policy`**
 * header, matching `'nonce-…'`. An earlier version of this file invented a
 * private `x-fete-csp` header and set the policy on the response only. Nothing
 * read it, the nonce never reached React, and every inline script in the built
 * app was refused — the page rendered its server HTML and then never hydrated.
 *
 * The worry that motivated the private name was that a client could send its
 * own `Content-Security-Policy` on the request, and copying request headers into
 * the forwarded set would carry that value into the string Next reads. The fix
 * for that is `set`, not a different name: `requestHeaders.set` below replaces
 * any client-supplied value outright, so the nonce Next sees is always ours.
 *
 * ── The pages must be dynamically rendered ──────────────────────────────────
 *
 * A nonce cannot exist at build time, so a statically prerendered page has no
 * nonce to stamp. Next documents this, and it is why `app/page.tsx` and
 * `app/plan/[id]/page.tsx` call `connection()`: it makes them render per
 * request. Without that call the build still succeeds and the CSP header still
 * looks correct, which is exactly what made this failure survive the unit tests.
 *
 * The `matcher` below deliberately excludes static assets: a nonce on a
 * `.js`/`.css` file would be meaningless, would defeat Vercel's CDN caching for
 * those paths, and would add an Edge invocation per asset request.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, CSP_REQUEST_HEADER, generateNonce } from '@/lib/security/csp';

const isDev = process.env.NODE_ENV !== 'production';

export function middleware(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const csp = buildCsp({ nonce, isDev });

  const requestHeaders = new Headers(request.headers);
  // Next reads the nonce from this header during `renderToReadableStream`, and
  // attaches it to every script and style tag it emits. `set` (rather than
  // `append`) is what makes the value ours and not the caller's.
  requestHeaders.set(CSP_REQUEST_HEADER, csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  // A nonce-bearing response must never be cached by a shared cache, or one
  // visitor's nonce would be replayed to another.
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  /**
   * Run on page routes only.
   *
   * Excluded: API routes (they return JSON and stream, and the security headers
   * they need are set by `next.config.ts`), Next's static output, the image
   * optimiser, and any request for a file with an extension.
   */
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)'],
};
