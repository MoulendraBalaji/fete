'use client';

import { useMemo, useState } from 'react';
import type { Brief } from '@/lib/schemas/brief';
import type { EventType } from '@/lib/schemas/core';
import { buildDemoPlan, demoBriefFor } from '@/lib/domain/seeds';
import { createPlan } from '@/lib/domain/plan';
import { EVENT_TYPES } from '@/lib/schemas/core';
import { EVENT_TYPE_BLURBS, EVENT_TYPE_LABELS } from '@/lib/ui/labels';
import { usePlanLibrary } from '@/lib/hooks/usePlanLibrary';
import { localTodayIso } from '@/lib/client/browser';
import Link from 'next/link';
import { IntakeWizard, emptyDraft, type IntakeDraft } from '@/components/intake/IntakeWizard';
import { PlanLibrary } from '@/components/workspace/PlanLibrary';
import { Logo } from '@/components/brand/Logo';
import { ThemeToggle } from '@/components/brand/ThemeToggle';
import { Button } from '@/components/ui/Button';
import { Rule } from '@/components/ui/Rule';
import { Toast } from '@/components/ui/Toast';
import styles from './HomeClient.module.css';

type Mode = 'browse' | 'intake';

/** Converts a demo brief into the wizard's string-typed draft. */
function draftFromBrief(brief: Brief): IntakeDraft {
  return {
    ...emptyDraft(),
    eventType: brief.eventType,
    date: brief.date,
    location: brief.location,
    guestCount: String(brief.guestCount),
    budget: String(brief.budgetMinor / 100),
    currency: brief.currency,
    theme: brief.theme,
    considerations: brief.considerations,
    mustHaves: brief.mustHaves.join(', '),
    avoid: brief.avoid.join(', '),
    priorities: [...brief.priorities],
  };
}

/**
 * The home page: pick up where you left off, start a new plan, or open a sample.
 *
 * It is a client component because the whole library lives in `localStorage`.
 * The trade-off is that the first paint cannot know how many plans exist, so a
 * short "opening" state is shown rather than a flash of an empty library.
 */
export function HomeClient() {
  const library = usePlanLibrary();
  const today = useMemo(() => localTodayIso(), []);
  const [mode, setMode] = useState<Mode>('browse');
  const [seed, setSeed] = useState<Partial<IntakeDraft> | undefined>(undefined);

  function startBlank(eventType: EventType = 'wedding') {
    setSeed({ ...emptyDraft(), eventType });
    setMode('intake');
  }

  function startSample(eventType: EventType) {
    setSeed(draftFromBrief(demoBriefFor(eventType, today)));
    setMode('intake');
  }

  /** Skips the wizard entirely: build the full demo dossier and open it. */
  function openSampleDirectly(eventType: EventType) {
    const plan = buildDemoPlan(eventType, { todayIso: today });
    library.add(plan);
    library.notify({
      message: `Opened the ${EVENT_TYPE_LABELS[eventType]} sample.`,
      tone: 'success',
    });
    window.location.assign(`/plan/${plan.id}`);
  }

  if (!library.ready) {
    return (
      <div className={styles.loading} aria-live="polite">
        <p>Opening your plans…</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/">
          <Logo variant="seal" />
          <span className="srOnly">Fête home</span>
        </Link>
        <ThemeToggle />
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>Stationery &amp; ledger</p>
        <h1 className={styles.heroTitle}>
          A plan that <em>adds up</em>, not a pile of lists.
        </h1>
        <p className={styles.heroBody}>
          Fête keeps the books for a wedding, a milestone birthday or a community gathering: a
          budget in whole minor units that always reconciles, a countdown built backwards from the
          day, a roster that compares quotes with the envelope, and an assistant that reasons over
          your actual brief. Everything stays in your browser.
        </p>
        <div className={styles.heroActions}>
          <Button variant="primary" size="lg" onClick={() => startBlank()}>
            Start a plan
          </Button>
          <Button variant="secondary" size="lg" onClick={() => setMode('browse')}>
            See my plans
          </Button>
        </div>
        <ul className={styles.points}>
          <li>
            <strong>No account.</strong> Your plans live in this browser and nowhere else.
          </li>
          <li>
            <strong>Works offline.</strong> Budgets, timelines and rosters are computed locally; the
            assistant is a bonus.
          </li>
          <li>
            <strong>Shareable.</strong> A link carries a read-only copy of the plan itself — no
            server, no database.
          </li>
        </ul>
      </section>

      <Rule />

      {mode === 'intake' ? (
        <IntakeWizard
          initial={seed}
          onComplete={(brief) => {
            const created = createPlan(brief, { todayIso: today });
            library.add(created);
            library.notify({ message: `“${created.name}” is ready.`, tone: 'success' });
            window.location.assign(`/plan/${created.id}`);
          }}
          onCancel={() => setMode('browse')}
          samples={EVENT_TYPES.map((type) => ({ eventType: type, label: EVENT_TYPE_LABELS[type] }))}
          onPickSample={(eventType) => startSample(eventType)}
        />
      ) : (
        <div className={styles.browse}>
          <section className={styles.samples}>
            <h2 className={styles.sectionTitle}>Try a sample</h2>
            <p className={styles.sectionSub}>
              Three fully worked dossiers — budget allocation, countdown, vendor quotes and all.
              Open one to see how the workspace behaves, then edit it freely.
            </p>
            <div className={styles.sampleGrid}>
              {EVENT_TYPES.map((type) => (
                <div key={type} className={styles.sampleCard}>
                  <h3 className={styles.sampleTitle}>{EVENT_TYPE_LABELS[type]}</h3>
                  <p className={styles.sampleBlurb}>{EVENT_TYPE_BLURBS[type]}</p>
                  <div className={styles.sampleActions}>
                    <Button size="sm" variant="secondary" onClick={() => openSampleDirectly(type)}>
                      Open the sample
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => startSample(type)}>
                      Start from it
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <PlanLibrary
            plans={library.summaries}
            activeId={library.activeId}
            onCreate={() => startBlank()}
            onOpen={(id) => window.location.assign(`/plan/${id}`)}
            onDuplicate={library.duplicate}
            onDelete={library.remove}
            onImport={library.importFile}
            onExport={library.exportPlan}
          />
        </div>
      )}

      <Rule />

      <footer className={styles.foot}>
        <span>Fête — planning that keeps its books.</span>
        <span className={styles.footNote}>
          Amounts are stored as integer minor units; the AI never changes a number without you
          accepting it.
        </span>
      </footer>

      {library.notice ? (
        <Toast
          message={library.notice.message}
          tone={library.notice.tone}
          action={library.notice.undo ? { label: 'Undo', onClick: library.notice.undo } : undefined}
          onDismiss={library.dismissNotice}
        />
      ) : null}
    </div>
  );
}
