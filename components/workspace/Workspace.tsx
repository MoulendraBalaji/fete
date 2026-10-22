'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Idea, Plan } from '@/lib/schemas/plan';
import { applyTransfer, computeLedger } from '@/lib/domain/budget';
import { buildIcs } from '@/lib/domain/ics';
import { rebuildPlan } from '@/lib/domain/plan';
import { moveTimelineItem } from '@/lib/domain/timeline';
import { newId } from '@/lib/domain/id';
import { buildSharePath } from '@/lib/share/encode';
import {
  absoluteUrl,
  copyText,
  downloadText,
  icsDataUrl,
  localTodayIso,
  nowStamp,
} from '@/lib/client/browser';
import {
  requestBudgetAdvice,
  requestIdeas,
  requestVendorTips,
  type AiFailure,
} from '@/lib/client/ai';
import type { Brief } from '@/lib/schemas/brief';
import { usePlanLibrary, type LibraryNotice } from '@/lib/hooks/usePlanLibrary';
import { Ledger } from './Ledger';
import { Roster } from './Roster';
import { Timeline } from './Timeline';
import { Muse } from './Muse';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Stamp } from '@/components/ui/Stamp';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { Toast } from '@/components/ui/Toast';
import { Rule } from '@/components/ui/Rule';
import { Logo } from '@/components/brand/Logo';
import { ThemeToggle } from '@/components/brand/ThemeToggle';
import { BriefEditor } from './BriefEditor';
import { EVENT_TYPE_LABELS } from '@/lib/ui/labels';
import styles from './Workspace.module.css';

/**
 * The chat panel is the single heaviest client component and is entirely
 * optional, so it is code-split: its bundle (and the streaming client) only
 * load when the user actually opens the tab.
 */
const ChatPanel = dynamic(() => import('./ChatPanel'), {
  ssr: false,
  loading: () => <Sheet>Loading the assistant…</Sheet>,
});

export type WorkspaceTab = 'ledger' | 'timeline' | 'roster' | 'muse' | 'chat';

export interface WorkspaceProps {
  /** A read-only snapshot decoded from a share link, used to seed the library. */
  sharedPlan?: Plan;
}

/**
 * The workspace: everything after the brief exists.
 *
 * State model — deliberately simple and boring:
 *  - the plan library lives in `usePlanLibrary`, the only module that touches
 *    `localStorage`;
 *  - every mutation is written through immediately, so there is no save button
 *    and no way to lose work to a refresh;
 *  - AI output is merged into the plan only after the server has validated it
 *    against the schema, and is always attributed in the UI.
 */
export function Workspace({ sharedPlan }: WorkspaceProps) {
  const library = usePlanLibrary(sharedPlan);
  const [tab, setTab] = useState<WorkspaceTab>('ledger');
  /**
   * Which panels have ever been shown.
   *
   * `Tabs` keeps a panel mounted once it exists so a half-typed budget row or a
   * scroll position survives a glance at another section. Building all five
   * panels up front would honour that at the cost of rendering four sections the
   * user may never open, so each panel is created on first visit and kept from
   * then on.
   */
  const [visited, setVisited] = useState<ReadonlySet<WorkspaceTab>>(
    () => new Set<WorkspaceTab>(['ledger']),
  );
  const [briefOpen, setBriefOpen] = useState(false);
  const [localNotice, setLocalNotice] = useState<LibraryNotice | null>(null);

  const [ideasBusy, setIdeasBusy] = useState(false);
  const [ideasFromFallback, setIdeasFromFallback] = useState(false);
  const [tipsBusyKey, setTipsBusyKey] = useState<string | null>(null);
  const [advice, setAdvice] = useState<React.ReactNode>(null);
  const [adviceBusy, setAdviceBusy] = useState(false);

  // Guards against overlapping AI requests: only the newest may write state.
  const requestSeq = useRef(0);
  const today = useMemo(() => localTodayIso(), []);

  const notify = useCallback((notice: LibraryNotice) => setLocalNotice(notice), []);

  /** Switches tab and marks it visited, so its panel is built from now on. */
  const showTab = useCallback((id: WorkspaceTab) => {
    setTab(id);
    setVisited((current) => (current.has(id) ? current : new Set([...current, id])));
  }, []);

  const { activePlan, updateActive } = library;
  const notice = localNotice ?? library.notice;
  const dismissNotice = useCallback(() => {
    setLocalNotice(null);
    library.dismissNotice();
  }, [library]);

  /* ---------------------------------------------------------------- files */

  const handleIcs = useCallback(() => {
    if (!activePlan) return;
    downloadText(`${slug(activePlan.name)}.ics`, buildIcs(activePlan, nowStamp()), 'text/calendar');
  }, [activePlan]);

  const icsUrl = useMemo(
    () => (activePlan ? icsDataUrl(buildIcs(activePlan, nowStamp())) : undefined),
    [activePlan],
  );

  const handleShare = useCallback(async () => {
    if (!activePlan) return;
    const result = buildSharePath(activePlan);
    if (!result.ok) {
      notify({
        message: 'This plan is too large to fit in a link. Export the JSON file instead.',
        tone: 'danger',
      });
      return;
    }
    const outcome = await copyText(absoluteUrl(result.value));
    if (outcome === 'failed') {
      notify({
        message: 'Could not copy the link — your browser blocked clipboard access.',
        tone: 'danger',
      });
      return;
    }
    notify({
      message:
        result.fidelity === 'full'
          ? 'Link copied. It opens a read-only copy of this plan.'
          : 'Link copied. Descriptive notes were trimmed to keep the link short.',
      tone: 'success',
    });
  }, [activePlan, notify]);

  /* ------------------------------------------------------------------ AI */

  /** Reports a failed AI call without ever echoing upstream detail. */
  const reportFailure = useCallback(
    (failure: AiFailure, what: string) => {
      if (failure.code === 'aborted') return;
      notify({
        message:
          failure.status === 429
            ? `Slow down a moment — too many requests. Try again in ${failure.retryAfterSeconds ?? 30}s.`
            : `The planner could not ${what} just now. ${failure.message}`,
        tone: 'danger',
      });
    },
    [notify],
  );

  const generateIdeas = useCallback(async () => {
    if (!activePlan) return;
    const seq = ++requestSeq.current;
    setIdeasBusy(true);
    const existing = activePlan.ideas.map((idea) => idea.title);
    const result = await requestIdeas(activePlan.brief);
    if (seq !== requestSeq.current) return; // Superseded by a newer request.
    setIdeasBusy(false);

    if (!result.ok) {
      reportFailure(result, 'suggest ideas');
      return;
    }

    const incoming: Idea[] = result.data.ideas
      .filter((idea) => !existing.includes(idea.title))
      .map((idea) => ({
        id: newId(),
        kind: idea.kind,
        title: idea.title,
        body: idea.body,
        costTier: idea.costTier,
        pinned: false,
        dismissed: false,
        source: result.source === 'ai' ? 'ai' : 'seed',
      }));

    setIdeasFromFallback(result.source === 'fallback');
    updateActive((plan) => ({ ...plan, ideas: [...plan.ideas, ...incoming].slice(0, 40) }));
    notify({
      message: incoming.length
        ? `${incoming.length} new ideas.`
        : 'No new ideas this time — try again.',
      tone: 'info',
    });
  }, [activePlan, notify, reportFailure, updateActive]);

  const requestTips = useCallback(
    async (categoryKey: string) => {
      if (!activePlan) return;
      setTipsBusyKey(categoryKey);
      const result = await requestVendorTips(activePlan.brief, categoryKey);
      setTipsBusyKey(null);

      if (!result.ok) {
        reportFailure(result, 'research that vendor');
        return;
      }

      updateActive((plan) => ({
        ...plan,
        vendors: plan.vendors.map((vendor) =>
          vendor.categoryKey === categoryKey
            ? {
                ...vendor,
                questions: result.data.questions,
                redFlags: result.data.redFlags,
                tipsSource: result.source === 'ai' ? 'ai' : 'seed',
              }
            : vendor,
        ),
      }));
    },
    [activePlan, reportFailure, updateActive],
  );

  const requestAdvice = useCallback(async () => {
    if (!activePlan) return;
    setAdviceBusy(true);
    const result = await requestBudgetAdvice(activePlan.brief, activePlan.budget.rows);
    setAdviceBusy(false);

    if (!result.ok) {
      reportFailure(result, 'review the budget');
      return;
    }

    const { headline, tradeoffs, suggestions } = result.data;
    setAdvice(
      <Sheet tone="inset" printable={false}>
        <h4 className={styles.adviceTitle}>{headline}</h4>
        {result.source === 'fallback' ? (
          <p className={styles.adviceNote}>Standard review — the model was unavailable.</p>
        ) : null}

        {tradeoffs.length > 0 ? (
          <>
            <p className={styles.adviceLabel}>Trade-offs to weigh</p>
            <ul className={styles.adviceList}>
              {tradeoffs.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        ) : null}

        {suggestions.length > 0 ? (
          <>
            <Rule />
            <p className={styles.adviceLabel}>
              Suggested moves — each is a percentage of the total, applied only when you accept
            </p>
            <ul className={styles.transfers}>
              {suggestions.map((transfer) => (
                <li key={`${transfer.from}-${transfer.to}`} className={styles.transfer}>
                  <div>
                    <p className={styles.transferRoute}>
                      {transfer.from} → {transfer.to} · {transfer.percentOfTotal}%
                    </p>
                    <p className={styles.transferReason}>{transfer.rationale}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      updateActive((plan) => ({
                        ...plan,
                        budget: {
                          rows: applyTransfer(plan.budget.rows, plan.brief.budgetMinor, transfer),
                        },
                      }));
                      notify({
                        message: `Moved ${transfer.percentOfTotal}% from ${transfer.from} to ${transfer.to}.`,
                        tone: 'success',
                      });
                    }}
                  >
                    Apply
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Sheet>,
    );
  }, [activePlan, notify, reportFailure, updateActive]);

  // Derived from the whole budget, so it is recomputed only when the brief or
  // the rows actually change — not on every keystroke elsewhere in the plan.
  // Declared above the early returns because hooks must run on every render.
  const brief = activePlan?.brief;
  const budgetRows = activePlan?.budget.rows;
  const ledger = useMemo(
    () => (brief && budgetRows ? computeLedger(brief, budgetRows) : null),
    [brief, budgetRows],
  );

  /* -------------------------------------------------------------- render */

  if (!library.ready) {
    return (
      <main id="main" className={styles.loading} aria-live="polite">
        <p>Opening your plans…</p>
      </main>
    );
  }

  if (!activePlan) {
    // The only branch of this component that owns the page's `main` landmark, so
    // it must provide it: the root layout's skip link targets `#main`, and a
    // skip link that leads nowhere is an accessibility failure, not a nicety.
    return (
      <main id="main" className={styles.emptyShell}>
        <Logo />
        <Sheet>
          <h1 className={styles.emptyTitle}>Nothing here yet</h1>
          <p className={styles.emptyBody}>
            Return to the home page to start a plan. It takes five questions.
          </p>
          <div className={styles.emptyActions}>
            <Button variant="primary" onClick={() => window.location.assign('/')}>
              Go to the home page
            </Button>
          </div>
        </Sheet>
      </main>
    );
  }

  const fromIdeas = activePlan.timeline.items.filter((item) => item.id.startsWith('idea-')).length;

  const tabs: TabItem[] = [
    {
      id: 'ledger',
      label: 'Ledger',
      badge: String(ledger?.rows.length ?? 0),
      panel: visited.has('ledger') ? (
        <Ledger
          brief={activePlan.brief}
          rows={activePlan.budget.rows}
          onChange={(rows) => updateActive((plan) => ({ ...plan, budget: { rows } }))}
          onRequestAdvice={() => void requestAdvice()}
          adviceBusy={adviceBusy}
          advice={advice}
        />
      ) : null,
    },
    {
      id: 'timeline',
      label: 'Timeline',
      badge: String(activePlan.timeline.items.filter((item) => !item.done).length),
      panel: visited.has('timeline') ? (
        <Timeline
          plan={activePlan}
          todayIso={today}
          onExportIcs={handleIcs}
          icsUrl={icsUrl}
          onMove={(id, direction) =>
            updateActive((plan) => ({
              ...plan,
              timeline: { items: moveTimelineItem(plan.timeline.items, id, direction) },
            }))
          }
          onToggleDone={(id) =>
            updateActive((plan) => ({
              ...plan,
              timeline: {
                items: plan.timeline.items.map((item) =>
                  item.id === id ? { ...item, done: !item.done } : item,
                ),
              },
            }))
          }
        />
      ) : null,
    },
    {
      id: 'roster',
      label: 'Roster',
      badge: String(activePlan.vendors.filter((vendor) => vendor.status === 'todo').length || ''),
      panel: visited.has('roster') ? (
        <Roster
          plan={activePlan}
          tipsBusyKey={tipsBusyKey}
          onRequestTips={(key) => void requestTips(key)}
          onChange={(vendors) => updateActive((plan) => ({ ...plan, vendors }))}
        />
      ) : null,
    },
    {
      id: 'muse',
      label: 'Muse',
      badge: String(activePlan.ideas.filter((idea) => !idea.dismissed).length || ''),
      panel: visited.has('muse') ? (
        <Muse
          ideas={activePlan.ideas}
          busy={ideasBusy}
          fromFallback={ideasFromFallback}
          timelineCount={fromIdeas}
          onGenerate={() => void generateIdeas()}
          onTogglePin={(id) =>
            updateActive((plan) => ({
              ...plan,
              ideas: plan.ideas.map((idea) =>
                idea.id === id ? { ...idea, pinned: !idea.pinned } : idea,
              ),
            }))
          }
          onDismiss={(id) => {
            updateActive((plan) => ({
              ...plan,
              ideas: plan.ideas.map((idea) =>
                idea.id === id ? { ...idea, dismissed: true } : idea,
              ),
            }));
            notify({
              message: 'Idea dismissed.',
              tone: 'info',
              undo: () =>
                updateActive((plan) => ({
                  ...plan,
                  ideas: plan.ideas.map((idea) =>
                    idea.id === id ? { ...idea, dismissed: false } : idea,
                  ),
                })),
            });
          }}
          onAddToTimeline={(id) => {
            const idea = activePlan.ideas.find((candidate) => candidate.id === id);
            if (!idea) return;
            const item = {
              id: `idea-${idea.id.replace(/-/g, '').slice(0, 20)}${newId().slice(0, 4)}`,
              phase: 'milestone' as const,
              title: idea.title.slice(0, 80),
              detail: idea.body.slice(0, 220),
              dueDate: today,
              done: false,
              order: activePlan.timeline.items.length,
              compressed: false,
            };
            updateActive((plan) => ({
              ...plan,
              timeline: { items: [...plan.timeline.items, item] },
            }));
            showTab('timeline');
            notify({ message: 'Added to the timeline as a task due today.', tone: 'success' });
          }}
        />
      ) : null,
    },
    {
      id: 'chat',
      label: 'Ask',
      panel: visited.has('chat') ? <ChatPanel plan={activePlan} todayIso={today} /> : null,
    },
  ];

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brandLink} href="/" data-print="hide">
          <Logo variant="seal" />
          <span className="srOnly">Fête home</span>
        </Link>

        <div className={styles.planMeta}>
          <h1 className={styles.planName}>{activePlan.name}</h1>
          <span className={styles.planSub}>
            <Stamp tone="neutral" small>
              {EVENT_TYPE_LABELS[activePlan.brief.eventType]}
            </Stamp>
            <span className={styles.planLocation}>{activePlan.brief.location}</span>
          </span>
        </div>

        <div className={styles.toolbar} data-print="hide">
          <ThemeToggle />
          <Button size="sm" variant="secondary" onClick={() => setBriefOpen((open) => !open)}>
            Edit brief
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void handleShare()}>
            Copy link
          </Button>
          <Button size="sm" variant="ghost" onClick={handleIcs}>
            .ics
          </Button>
          <Button size="sm" variant="ghost" onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </header>

      {briefOpen ? (
        <div className={styles.briefWrap} data-print="hide">
          <BriefEditor
            brief={activePlan.brief}
            onCancel={() => setBriefOpen(false)}
            onSave={(brief: Brief) => {
              updateActive((plan) => rebuildPlan(plan, brief, today));
              setBriefOpen(false);
              notify({
                message: 'The plan was re-derived from your brief.',
                tone: 'success',
              });
            }}
          />
        </div>
      ) : null}

      <main className={styles.main} id="main">
        <Tabs
          items={tabs}
          activeId={tab}
          onChange={(id) => showTab(id as WorkspaceTab)}
          label="Plan sections"
        />
      </main>

      <Rule />
      <footer className={styles.foot} data-print="hide">
        <span>
          {library.summaries.length} {library.summaries.length === 1 ? 'plan' : 'plans'} on this
          device
        </span>
        <Link href="/" className={styles.footLink}>
          Manage plans
        </Link>
      </footer>

      {notice ? (
        <Toast
          message={notice.message}
          tone={notice.tone}
          action={
            notice.undo
              ? {
                  label: 'Undo',
                  onClick: () => {
                    notice.undo?.();
                    setLocalNotice(null);
                  },
                }
              : undefined
          }
          onDismiss={dismissNotice}
        />
      ) : null}
    </div>
  );
}

/** Filesystem-safe name derived from a plan title. */
function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'fete-plan'
  );
}
