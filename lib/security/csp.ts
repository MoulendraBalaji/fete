/**
 * Content Security Policy construction, shared by middleware and tests.
 *
 * ── Why a nonce instead of `'unsafe-inline'` ────────────────────────────────
 *
 * The previous policy granted `script-src 'self' 'unsafe-inline'` because Next
 * emits inline scripts (the streamed flight payload, the suspense bootstrap and
 * this app's theme snippet) and `next/script` does not hash its output. That
 * worked, but `'unsafe-inline'` is a blanket permission: *any* inline script
 * that reaches the document executes, including one injected by a bug
 * elsewhere.
 *
 * A per-request nonce narrows that to "the scripts we emitted for this
 * response". `'strict-dynamic'` then carries that trust to the scripts those
 * scripts create at runtime, and `'self'` remains as the fallback for browsers
 * without `'strict-dynamic'` support; see `buildCsp` for why both are needed.
 *
 * ── The nonce must reach React's rendered output ────────────────────────────
 *
 * Setting the CSP on the *response* alone is not enough: the nonce has to be
 * attached to the inline `<script>` tags themselves, or the browser blocks
 * them. Next reads the nonce from the request's **`Content-Security-Policy`**
 * header, so middleware sets it on **both** the forwarded request and the
 * response. That is the mechanism that makes this work without threading a
 * nonce through every component.
 *
 * The header name is fixed by Next, and it must be written with `set` so a
 * caller-supplied value cannot take its place; see `CSP_REQUEST_HEADER`.
 *
 * ── Cost: pages become dynamic ──────────────────────────────────────────────
 *
 * A nonce is unique per request, so a page carrying one cannot be statically
 * prerendered and reused — Next documents this, and there is no way around it:
 * a static page is generated at build time, when no request headers exist.
 *
 * Saying so in a comment is not enough, which this project learned the hard
 * way: the pages *were* static, the nonce was never applied, and the only
 * symptom was a production page that never became interactive while its CSP
 * header looked perfectly correct. The behaviour is enforced by `connection()`
 * in `app/page.tsx` and `app/plan/[id]/page.tsx`, and asserted by
 * `tests/csp.node.test.ts`, so the comment cannot drift from the code again.
 *
 * The price is cheap here: both routes were already client-rendered shells
 * whose real content comes from localStorage, so the server work is a layout
 * and an empty mount point, not a data fetch. There is no database and no
 * per-request I/O.
 */

/** `style-src` keeps `'unsafe-inline'`; see `buildCsp` for the justification. */
export interface CspOptions {
  nonce: string;
  /** Development needs `'unsafe-eval'` for webpack HMR and React Refresh. */
  isDev: boolean;
}

/**
 * Builds the policy for one response.
 *
 * Two allowances are deliberate, and both are narrower than they look:
 *
 *  - `style-src 'unsafe-inline'` is **required**. Next injects a `<style>` block
 *    for its font and layout handling, and `style-src-attr` would not cover it.
 *    Unlike a script, a style cannot read the DOM, open a socket or exfiltrate
 *    anything on its own; the risk it carries is CSS-based UI redress. The app
 *    renders no user-authored CSS and there is no `dangerouslySetInnerHTML`
 *    anywhere, so there is no path for user text to become a style rule.
 *  - `'unsafe-eval'` is granted **only** in development, where webpack's eval
 *    source maps and the React Refresh runtime require it. Production omits it.
 *
 * ── Why `'strict-dynamic'` is required ─────────────────────────────────────
 *
 * `'strict-dynamic'` is not decoration here; without it this app does not
 * hydrate. It does two things, and both are needed:
 *
 *  - It makes a browser **ignore `'self'`** in `script-src`, so only nonce- (or
 *    hash-) carrying scripts load, plus scripts that a *trusted* script creates.
 *  - It propagates that trust to scripts created at runtime.
 *
 * The second is the load-bearing one. Next's webpack runtime loads a chunk by
 * building an inline `<script>` element in JavaScript. That script is created
 * after the response exists, so it cannot carry the server's nonce, and it is
 * refused by a policy of `'self' 'nonce-…'` alone. The browser reports it against
 * the *chunk* that created it, which is the clue that identifies this case.
 *
 * So the policy needs the nonce (to admit the server-rendered inline scripts)
 * **and** `'strict-dynamic'` (to admit what those scripts go on to create). The
 * earlier version of this file had the nonce but not `'strict-dynamic'`, which
 * left exactly one violation in production: a chunk refusing to load because it
 * could not inject its own bootstrap.
 *
 * ── The nonce is what makes it safe, so the nonce must actually arrive ──────
 *
 * `'strict-dynamic'` disables `'self'`, which means the whole policy rests on
 * the nonce being present on the initial scripts. If the nonce does not reach
 * React, *nothing* loads — not the chunks, not the inline bootstrap — and the
 * page silently never hydrates. That is a worse failure than the one it fixes,
 * and it is why the pages must be dynamically rendered; see the module comment
 * above and `app/page.tsx`.
 */
export function buildCsp({ nonce, isDev }: CspOptions): string {
  const scriptSrc = [
    // Disabled by `'strict-dynamic'` in modern browsers, but kept for the ones
    // that do not support it, where it is the only thing allowing the chunks.
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    isDev ? "'unsafe-eval'" : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    // All LLM traffic is server-side, so the browser never reaches a provider.
    // Development additionally needs the HMR socket.
    isDev ? "connect-src 'self' ws: http://localhost:*" : "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    // Blocks a cross-origin subresource from reading this document's bytes.
    "worker-src 'self' blob:",
    isDev ? undefined : 'upgrade-insecure-requests',
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * Header middleware sets on the forwarded request so Next can read the nonce.
 *
 * This is the standard `Content-Security-Policy` header, not a private one, and
 * that is a hard requirement rather than a preference: Next parses the nonce
 * only from this header. A `x-fete-…`-style name is silently ignored, which
 * means the nonce never reaches React, no `<script>` tag is stamped, and the
 * built app loads its HTML and then fails to hydrate.
 *
 * Spoofing is not a reason to rename it. A client may send this header on the
 * way in, but middleware uses `Headers.set` to write the policy, which replaces
 * whatever arrived — so the value Next reads is always the one minted for this
 * request.
 */
export const CSP_REQUEST_HEADER = 'content-security-policy';

/**
 * Generates a nonce. `crypto.randomUUID` is available in the Edge runtime and
 * in Node 20+, so this needs no polyfill or import.
 */
export function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
