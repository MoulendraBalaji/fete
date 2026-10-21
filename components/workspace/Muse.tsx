'use client';

import type { Idea } from '@/lib/schemas/plan';
import { COST_TIER_LABELS, COST_TIER_TONES, IDEA_KIND_LABELS } from '@/lib/ui/labels';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Stamp } from '@/components/ui/Stamp';
import { EmptyState } from '@/components/ui/EmptyState';
import { Callout } from '@/components/ui/Callout';
import styles from './Muse.module.css';

export interface MuseProps {
  ideas: Idea[];
  /** Trigger a fresh batch from the planner. */
  onGenerate: () => void;
  onTogglePin: (id: string) => void;
  onDismiss: (id: string) => void;
  /** Promote a kept idea to a dated milestone. */
  onAddToTimeline: (id: string) => void;
  busy: boolean;
  /** True when the last batch came from the deterministic fallback. */
  fromFallback: boolean;
  /** Number of pinned ideas already promoted, for the hint. */
  timelineCount: number;
}

/**
 * The Muse: an idea board.
 *
 * Ideas arrive from the model but are never auto-applied. Pinning keeps one
 * visible; "add to timeline" is the only control that changes the plan, and it
 * is always a deliberate click. Dismissed ideas are hidden, not deleted, so an
 * accidental dismissal is recoverable via undo in the toast.
 */
export function Muse({
  ideas,
  onGenerate,
  onTogglePin,
  onDismiss,
  onAddToTimeline,
  busy,
  fromFallback,
  timelineCount,
}: MuseProps) {
  const visible = ideas.filter((idea) => !idea.dismissed);
  const pinned = visible.filter((idea) => idea.pinned);
  const rest = visible.filter((idea) => !idea.pinned);

  return (
    <div className={styles.wrap}>
      <Sheet className={styles.intro} tone="inset" printable={false}>
        <div className={styles.introRow}>
          <div>
            <h3 className={styles.title}>Muse</h3>
            <p className={styles.sub}>
              Suggestions drawn from your brief — theme, menu, activities, favours, volunteers.
              Nothing is added to the plan until you choose it.
            </p>
          </div>
          <Button variant="primary" busy={busy} onClick={onGenerate}>
            {visible.length ? 'More ideas' : 'Suggest ideas'}
          </Button>
        </div>

        {fromFallback && visible.length > 0 ? (
          <Callout tone="note" title="Standard suggestions">
            The planner is offline, so these come from a built-in library rather than your brief.
            They are still worth a scan.
          </Callout>
        ) : null}
      </Sheet>

      {visible.length === 0 ? (
        <Sheet>
          <EmptyState
            title="No ideas yet"
            action={
              <Button variant="primary" busy={busy} onClick={onGenerate}>
                Suggest ideas
              </Button>
            }
          >
            Ask the Muse for a first batch, or start from the samples on the home page.
          </EmptyState>
        </Sheet>
      ) : (
        <>
          {pinned.length > 0 ? (
            <section className={styles.group} data-print="avoid-break">
              <h4 className={styles.groupTitle}>
                Pinned{' '}
                <Stamp tone="gold" small>
                  {pinned.length}
                </Stamp>
              </h4>
              <div className={styles.board}>
                {pinned.map((idea) => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    onTogglePin={onTogglePin}
                    onDismiss={onDismiss}
                    onAddToTimeline={onAddToTimeline}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {rest.length > 0 ? (
            <section className={styles.group} data-print="avoid-break">
              {pinned.length > 0 ? <h4 className={styles.groupTitle}>Everything else</h4> : null}
              <div className={styles.board}>
                {rest.map((idea) => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    onTogglePin={onTogglePin}
                    onDismiss={onDismiss}
                    onAddToTimeline={onAddToTimeline}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      {timelineCount > 0 ? (
        <p className={styles.footnote}>
          {timelineCount} {timelineCount === 1 ? 'idea has' : 'ideas have'} been added to the
          timeline.
        </p>
      ) : null}
    </div>
  );
}

function IdeaCard({
  idea,
  onTogglePin,
  onDismiss,
  onAddToTimeline,
}: {
  idea: Idea;
  onTogglePin: (id: string) => void;
  onDismiss: (id: string) => void;
  onAddToTimeline: (id: string) => void;
}) {
  return (
    <article
      className={[styles.card, idea.pinned ? styles.cardPinned : ''].filter(Boolean).join(' ')}
      data-print="avoid-break"
    >
      <header className={styles.cardHead}>
        <span className={styles.kind}>{IDEA_KIND_LABELS[idea.kind]}</span>
        <Stamp tone={COST_TIER_TONES[idea.costTier]} small>
          {COST_TIER_LABELS[idea.costTier]}
        </Stamp>
      </header>

      <h5 className={styles.cardTitle}>{idea.title}</h5>
      <p className={styles.cardBody}>{idea.body}</p>

      <footer className={styles.cardFoot} data-print="hide">
        <Button
          size="sm"
          variant={idea.pinned ? 'primary' : 'ghost'}
          aria-pressed={idea.pinned}
          onClick={() => onTogglePin(idea.id)}
        >
          {idea.pinned ? 'Pinned' : 'Pin'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onAddToTimeline(idea.id)}>
          Add to timeline
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDismiss(idea.id)}
          aria-label={`Dismiss “${idea.title}”`}
        >
          Dismiss
        </Button>
      </footer>

      {idea.source === 'seed' ? <span className={styles.sourceNote}>built-in library</span> : null}
    </article>
  );
}
