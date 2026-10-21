import { HomeClient } from './HomeClient';

/**
 * The landing page.
 *
 * The shell is a server component so the page has a real title and description
 * in the HTML that search engines and link previews see; everything stateful is
 * inside `HomeClient`, which owns the `localStorage`-backed plan library.
 */
export default function HomePage() {
  return (
    <main id="main">
      <HomeClient />
    </main>
  );
}
