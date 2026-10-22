import { PlanWorkspace } from './PlanWorkspace';

/**
 * The workspace for one plan.
 *
 * The `id` in the path names a plan in the browser's own library. A plan shared
 * by link arrives separately, in the URL *hash* (`#plan=…`), which the server
 * never sees — so the page renders the same shell for every plan and the client
 * resolves which one to open. Selecting by path rather than by hash also means
 * the browser's history and reloads behave normally.
 *
 * `app/layout.tsx` forces dynamic rendering for the CSP nonce, so this route is
 * rendered per request; see that file. The `id` is only read to pass along.
 */
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlanWorkspace id={id} />;
}
