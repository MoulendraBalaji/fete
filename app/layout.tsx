import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Caveat, Fraunces, Hanken_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import './print.css';

/**
 * Four faces, each with one job:
 *  - Fraunces (display): headings and the wordmark — a workhorse serif with
 *    enough character to read as stationery rather than a dashboard.
 *  - Hanken Grotesk (body): UI text; neutral, legible at small sizes.
 *  - IBM Plex Mono (ledger): money, dates and reference codes, with tabular
 *    figures so columns of numbers actually line up.
 *  - Caveat (hand): margin notes and empty-state flourishes.
 *
 * Fonts are self-hosted by `next/font`, so there is no render-blocking request
 * to Google and no layout shift. Each is exposed as a CSS variable that the
 * tokens in globals.css consume.
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
  axes: ['SOFT', 'WONK'],
});

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-hanken',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '600'],
  variable: '--font-plex-mono',
});

const caveat = Caveat({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-caveat',
});

export const metadata: Metadata = {
  title: {
    default: 'Fête — event planning that keeps its books',
    template: '%s · Fête',
  },
  description:
    'A GenAI planning assistant for weddings, birthdays and community events: a real budget ledger, a countdown built backwards from the day, a vendor roster and an assistant that reasons over your plan. Works offline.',
  applicationName: 'Fête',
  authors: [{ name: 'Fête' }],
  keywords: ['event planning', 'wedding budget', 'party planning', 'planner', 'GenAI'],
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Fête — event planning that keeps its books',
    description:
      'Plan a wedding, birthday or community event with a budget that adds up, a timeline that counts down, and an assistant that knows your brief.',
    type: 'website',
    siteName: 'Fête',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f1e6' },
    { media: '(prefers-color-scheme: dark)', color: '#191719' },
  ],
};

const fontClasses = [fraunces.variable, hanken.variable, plexMono.variable, caveat.variable].join(
  ' ',
);

/**
 * Applies the stored theme before first paint.
 *
 * Delivered through `next/script` with `beforeInteractive` rather than an inline
 * `<script dangerouslySetInnerHTML>`: the project forbids injecting raw HTML,
 * and this is the framework's supported path for a pre-hydration snippet. It
 * reads one localStorage key, writes one attribute and nothing else.
 *
 * The `nonce` attribute is applied by Next itself, not written here: middleware
 * (`middleware.ts`) puts the per-response policy on the forwarded request's CSP
 * header, React reads it into `HeadManagerContext`, and `next/script` stamps it
 * on the tag. Hardcoding a nonce in this file would be impossible anyway — it
 * changes every request.
 */
const THEME_INIT = `(function(){try{var t=localStorage.getItem('fete.theme');if(t!=='evening'&&t!=='day'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'evening':'day';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','day');}})();`;

/**
 * The root layout.
 *
 * ── Why `force-dynamic` is here ─────────────────────────────────────────────
 *
 * The CSP nonce needs a per-request render: a build-time prerender has no nonce
 * to stamp, so every inline script is refused and the app renders without ever
 * hydrating. `export const dynamic = 'force-dynamic'` is the way to guarantee
 * that. (An earlier version used `await connection()`, which works — but it
 * makes the layout async and is unnecessary. This export has no such cost.)
 *
 * ── About the metadata, which is *not* in `<head>` for browsers ─────────────
 *
 * `metadata` below is deliberately left as-is even though the served HTML shows
 * `<title>` and `<meta name="description">` after `</head>` rather than inside
 * it. That is Next's **Streaming Metadata**, not a bug and not something this
 * app can fix in its own code:
 *
 *  - For a dynamically rendered page, Next streams the metadata separately so
 *    the visual content is not blocked on it, which is why it appears in the
 *    body when a normal browser (or Lighthouse) fetches the page.
 *  - Next detects crawler User-Agents and *disables* streaming for them, so
 *    bots receive the metadata in `<head>` where they look for it. Verified with
 *    a `Bingbot` User-Agent during this pass: the tags are in the head.
 *
 * So the SEO outcome is intact. Do not "fix" this by adding `htmlLimitedBots` to
 * `next.config.ts`: the option makes metadata blocking for *every* request and
 * regresses the rendering it exists to speed up. The one real consequence is for
 * a browser-side audit like Lighthouse, which reports "Document does not have a
 * meta description" against the streamed body — see the Verification section of
 * the README for the measured evidence and this explanation.
 */
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontClasses} data-theme="day" suppressHydrationWarning>
      <body>
        <Script id="fete-theme" strategy="beforeInteractive">
          {THEME_INIT}
        </Script>
        {/*
          Skip link for keyboard and screen-reader users. It is first in the
          document so it is the first thing Tab reaches, sits off-screen until
          focused (`.skipLink`), and targets the `id="main"` landmark both pages
          render. `data-print="hide"` keeps it out of print output.
        */}
        <a className="skipLink" href="#main">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
