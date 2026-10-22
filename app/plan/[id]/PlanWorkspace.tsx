'use client';

import { useEffect, useState } from 'react';
import type { Plan } from '@/lib/schemas/plan';
import { readPlanFromHash } from '@/lib/share/encode';
import { browserStorage, readEnvelope, upsertPlan } from '@/lib/storage/plans';
import { Workspace } from '@/components/workspace/Workspace';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/brand/Logo';
import styles from './PlanWorkspace.module.css';

export interface PlanWorkspaceProps {
  id: string;
}

/**
 * Resolves which plan to open, then hands off to the workspace.
 *
 * Two sources, in order of precedence:
 *  1. a shared snapshot in the hash — this is a *new* visitor following a link,
 *     so the snapshot is imported into their library as a normal, editable plan;
 *  2. the plan already stored under `id`.
 *
 * If neither exists the user gets a plain explanation rather than a 404, because
 * "this link is stale" is a much more common cause than a bad URL — and the
 * recovery action (start a plan) is one click away.
 */
export function PlanWorkspace({ id }: PlanWorkspaceProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [shared, setShared] = useState<Plan | undefined>(undefined);

  useEffect(() => {
    const storage = browserStorage();
    const envelope = readEnvelope(storage);

    // A share link always describes a *different* plan id to the URL, so the
    // snapshot is imported under its own id and the workspace opens it.
    const fromHash = readPlanFromHash(window.location.hash);
    if (fromHash && !envelope.plans.some((plan) => plan.id === fromHash.id)) {
      upsertPlan(storage, fromHash);
      setShared(fromHash);
      setState('ready');
      return;
    }

    setState(envelope.plans.some((plan) => plan.id === id) ? 'ready' : 'missing');
  }, [id]);

  if (state === 'loading') {
    // `id="main"` is required here, not decorative: the skip link in the root
    // layout targets `#main`, and Lighthouse flags a page whose skip link points
    // at nothing. Every branch of this component must own that landmark, since
    // only one of them renders at a time.
    return (
      <main id="main" className={styles.center} aria-live="polite">
        <p>Opening the plan…</p>
      </main>
    );
  }

  if (state === 'missing') {
    return (
      <main id="main" className={styles.center}>
        <Logo />
        <Sheet className={styles.card}>
          <h1 className={styles.title}>That plan is not on this device</h1>
          <p className={styles.body}>
            Plans are stored in the browser you created them in. If someone sent you a link, make
            sure you opened the whole link — including everything after the <code>#</code>.
          </p>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => window.location.assign('/')}>
              Back to my plans
            </Button>
          </div>
        </Sheet>
      </main>
    );
  }

  return <Workspace sharedPlan={shared} />;
}
