import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { config as middlewareConfig, middleware } from '@/middleware';
import { CSP_REQUEST_HEADER } from '@/lib/security/csp';

function run(url = 'http://localhost:3000/'): { csp: string; requestCsp: string } {
  const response = middleware(new NextRequest(url));
  return {
    csp: response.headers.get('content-security-policy') ?? '',
    // Next reads the nonce from the standard CSP header the middleware sets on
    // the request it forwards — reflected back by Next as
    // `x-middleware-request-<name>`. Without it the inline scripts render
    // unnonced and the built app never hydrates.
    requestCsp: response.headers.get(`x-middleware-request-${CSP_REQUEST_HEADER}`) ?? '',
  };
}

function scriptSrc(csp: string): string {
  return csp.split('; ').find((part) => part.startsWith('script-src ')) ?? '';
}

function nonceOf(csp: string): string | undefined {
  return scriptSrc(csp).match(/'nonce-([^']+)'/)?.[1];
}

describe('middleware', () => {
  it('sets the policy on the response', () => {
    const { csp } = run();
    expect(csp).toContain("default-src 'self'");
    expect(nonceOf(csp)).toBeTruthy();
  });

  it('emits a distinct nonce for every request', () => {
    const nonces = new Set(Array.from({ length: 200 }, () => nonceOf(run().csp)));
    expect(nonces.size).toBe(200);
    expect(nonces.has(undefined)).toBe(false);
  });

  it('never puts unsafe-inline in script-src, and keeps strict-dynamic', () => {
    const { csp } = run();
    expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
    // `'strict-dynamic'` is what lets Next's runtime-injected chunk bootstrap
    // run; see `lib/security/csp.ts`.
    expect(scriptSrc(csp)).toContain("'strict-dynamic'");
  });

  it('forwards the same policy on the request so Next can nonce its scripts', () => {
    const { csp, requestCsp } = run();
    expect(requestCsp).toBe(csp);
    expect(nonceOf(requestCsp)).toBe(nonceOf(csp));
  });

  it('ignores a nonce a client tries to inject on the request', () => {
    // Middleware builds the header from scratch rather than trusting an inbound
    // one, so a planted value cannot become the nonce the browser enforces.
    const request = new NextRequest('http://localhost:3000/', {
      headers: { 'content-security-policy': "script-src 'nonce-attackerchosen'" },
    });
    const response = middleware(request);
    expect(nonceOf(response.headers.get('content-security-policy') ?? '')).not.toBe(
      'attackerchosen',
    );
  });

  it('marks the response private and uncacheable so a nonce is never shared', () => {
    const response = middleware(new NextRequest('http://localhost:3000/'));
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('skips static assets and API routes via the matcher', () => {
    // The matcher is declarative config Next reads at build time; asserting its
    // shape here keeps a careless edit from putting a nonce on cached assets.
    const pattern = middlewareConfig.matcher[0] ?? '';
    expect(pattern).toContain('api');
    expect(pattern).toContain('_next/static');
  });

  it('overwrites a caller-supplied CSP header rather than honouring it', () => {
    // The forwarded request must carry the policy minted for *this* response.
    // A private header name was once used to dodge spoofing; `set` is the actual
    // defence and this asserts it, since a client can send any header it likes.
    const request = new NextRequest('http://localhost:3000/', {
      headers: { 'content-security-policy': "script-src 'unsafe-inline'" },
    });
    const response = middleware(request);
    const forwarded = response.headers.get('x-middleware-override-headers') ?? '';
    const csp = response.headers.get('Content-Security-Policy') ?? '';

    expect(forwarded).toContain(CSP_REQUEST_HEADER);
    expect(csp).toContain("'nonce-");
    // The caller's planted script policy must not survive: the forwarded
    // `script-src` is built fresh. (`style-src` legitimately keeps
    // `'unsafe-inline'`, so only the script directive is asserted here.)
    expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
    expect(scriptSrc(csp)).not.toContain('attackerchosen');
  });

  it('names its request header the standard one Next parses', () => {
    expect(CSP_REQUEST_HEADER).toBe('content-security-policy');
  });
});

describe('the app is dynamically rendered so the nonce can reach the page', () => {
  /**
   * The failure this guards against.
   *
   * A nonce cannot exist at build time, so a statically prerendered page has none
   * to stamp — Next documents this. The dangerous part is that nothing *fails*:
   * the build succeeds, the CSP header is correct, the unit tests above pass, and
   * the only symptom is a production page that renders its HTML and then never
   * hydrates because every inline script was refused.
   *
   * `export const dynamic = 'force-dynamic'` in the root layout is the fix, and
   * it is invisible to every other test here, so it is asserted by reading the
   * source. That is a blunt instrument, and deliberately so: the alternative is a
   * bug no unit test can see and that only appears in a production browser.
   *
   * Note what is *not* asserted here: where the metadata tags sit in the HTML.
   * For a dynamic page Next streams them into the body for ordinary browsers and
   * blocks them into the head for crawlers; that is framework behaviour with no
   * app-side fix, and pinning it would just make this suite brittle. See the
   * comment in `app/layout.tsx`.
   */
  const rootLayout = 'app/layout.tsx';
  const pages = ['app/page.tsx', 'app/plan/[id]/page.tsx'];

  async function read(relative: string): Promise<string> {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const root = fileURLToPath(new URL('..', import.meta.url));
    return readFileSync(`${root}${relative}`, 'utf8');
  }

  it('forces dynamic rendering from the root layout', async () => {
    expect(await read(rootLayout)).toContain("export const dynamic = 'force-dynamic'");
  });

  it('never forces static rendering', async () => {
    for (const file of [rootLayout, ...pages]) {
      // `force-static` silently defeats the nonce, and it reads as an
      // optimisation rather than as a security regression.
      expect(await read(file), `${file} must not force static rendering`).not.toContain(
        "dynamic = 'force-static'",
      );
    }
  });

  it('keeps the document metadata the whole app depends on', async () => {
    // `dynamic` was added alongside the metadata exports; this pins that they
    // were not lost in the process. They are what crawlers receive in `<head>`.
    const layout = await read(rootLayout);
    expect(layout).toContain('export const metadata');
    expect(layout).toContain('export const viewport');
    expect(layout).toContain('description:');
  });
});
