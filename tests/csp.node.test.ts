import { describe, expect, it } from 'vitest';
import { buildCsp, generateNonce, CSP_REQUEST_HEADER } from '@/lib/security/csp';

/** Extracts a directive's value, e.g. `script-src` → `'self' 'nonce-x' ...`. */
function directive(csp: string, name: string): string {
  const found = csp.split('; ').find((part) => part.startsWith(`${name} `));
  return found ?? '';
}

describe('buildCsp', () => {
  it('never grants unsafe-inline to script-src', () => {
    for (const isDev of [true, false]) {
      const csp = buildCsp({ nonce: generateNonce(), isDev });
      expect(directive(csp, 'script-src')).not.toContain("'unsafe-inline'");
    }
  });

  it('carries the nonce and strict-dynamic, and never unsafe-inline', () => {
    const nonce = 'abc123';
    const csp = buildCsp({ nonce, isDev: false });
    const scriptSrc = directive(csp, 'script-src');
    expect(scriptSrc).toContain(`'nonce-${nonce}'`);
    // `'self'` is kept for browsers that do not implement `'strict-dynamic'`.
    expect(scriptSrc).toContain("'self'");
    // `'strict-dynamic'` is required, not optional: Next's webpack runtime loads
    // a chunk by injecting an inline <script> at runtime, which can never carry
    // the server's nonce. Only `'strict-dynamic'` lets a trusted script create
    // another script. Removing it leaves that one chunk refused and the app
    // unhydrated — a regression this suite has already seen once.
    expect(scriptSrc).toContain("'strict-dynamic'");
    // The nonce is the thing `'strict-dynamic'` defers to, so `'unsafe-inline'`
    // must never appear alongside it: it would make the nonce decorative.
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('grants unsafe-eval only in development', () => {
    expect(directive(buildCsp({ nonce: 'n', isDev: true }), 'script-src')).toContain(
      "'unsafe-eval'",
    );
    expect(directive(buildCsp({ nonce: 'n', isDev: false }), 'script-src')).not.toContain(
      "'unsafe-eval'",
    );
  });

  it('keeps style-src unsafe-inline, which Next requires for its injected style block', () => {
    expect(directive(buildCsp({ nonce: 'n', isDev: false }), 'style-src')).toContain(
      "'unsafe-inline'",
    );
  });

  it('pins the structural directives that remove whole attack classes', () => {
    const csp = buildCsp({ nonce: 'n', isDev: false });
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
  });

  it('does not upgrade insecure requests in development', () => {
    expect(buildCsp({ nonce: 'n', isDev: true })).not.toContain('upgrade-insecure-requests');
    expect(buildCsp({ nonce: 'n', isDev: false })).toContain('upgrade-insecure-requests');
  });

  it('confines connect-src to self in production', () => {
    expect(directive(buildCsp({ nonce: 'n', isDev: false }), 'connect-src')).toBe(
      "connect-src 'self'",
    );
  });
});

describe('generateNonce', () => {
  it('produces a distinct value per call', () => {
    const values = new Set(Array.from({ length: 500 }, () => generateNonce()));
    expect(values.size).toBe(500);
  });

  it('emits only characters the Next nonce parser accepts', () => {
    // get-script-nonce-from-header.js matches /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/.
    // A nonce outside that alphabet is silently dropped, which would break every
    // inline script, so this guards the failure mode directly.
    for (let i = 0; i < 200; i += 1) {
      expect(generateNonce()).toMatch(/^[A-Za-z0-9+/_-]+={0,2}$/);
    }
  });

  it('is long enough not to be guessable', () => {
    expect(generateNonce().length).toBeGreaterThanOrEqual(16);
  });
});

describe('CSP_REQUEST_HEADER', () => {
  it('is the standard header name, because Next parses the nonce from it', () => {
    // This must be `content-security-policy`. Next extracts the nonce from this
    // header during rendering; a private name such as `x-fete-csp` is simply
    // never read, so the nonce never reaches React and every inline script in
    // the built app is refused. That regression shipped once already, so the
    // name is pinned here rather than left to a comment.
    expect(CSP_REQUEST_HEADER).toBe('content-security-policy');
  });
});
