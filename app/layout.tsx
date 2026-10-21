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
 */
const THEME_INIT = `(function(){try{var t=localStorage.getItem('fete.theme');if(t!=='evening'&&t!=='day'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'evening':'day';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','day');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontClasses} data-theme="day" suppressHydrationWarning>
      <body>
        <Script id="fete-theme" strategy="beforeInteractive">
          {THEME_INIT}
        </Script>
        {children}
      </body>
    </html>
  );
}
