'use client';

import { useMemo } from 'react';
import type { Plan, TimelineItem } from '@/lib/schemas/plan';
import {
  compareTimelineItems,
  daysBetween,
  formatMinutesOfDay,
  isOverdue,
  type MoveDirection,
} from '@/lib/domain/timeline';
import { formatPlanDate } from '@/lib/domain/plan';
import { Button, LinkButton } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Stamp } from '@/components/ui/Stamp';
import { Callout } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './Timeline.module.css';

export interface TimelineProps {
  plan: Plan;
  todayIso: string;
  onToggleDone: (id: string) => void;
  /** Moves an item one position earlier or later in the visible list. */
  onMove: (id: string, direction: MoveDirection) => void;
  onExportIcs: () => void;
  /** Whether the .ics data URL is ready (built lazily on the client). */
  icsUrl?: string;
}

/**
 * Countdown + run sheet.
 *
 * The countdown is the emotional core of the plan, so it is derived from the
 * event date on every render rather than stored — a cached "days to go" would
 * be wrong the moment the clock rolls past midnight.
 *
 * Milestones whose natural lead time fell before today arrive flagged as
 * "compressed", so the user understands why several tasks share one due date.
 */
export function Timeline({
  plan,
  todayIso,
  onToggleDone,
  onMove,
  onExportIcs,
  icsUrl,
}: TimelineProps) {
  const days = daysBetween(todayIso, plan.brief.date);
  const milestones = useMemo(
    () => plan.timeline.items.filter((item) => item.phase === 'milestone').sort(compareTimelineItems),
    [plan.timeline.items],
  );
  const dayOf = useMemo(
    () => plan.timeline.items.filter((item) => item.phase === 'dayof').sort(compareTimelineItems),
    [plan.timeline.items],
  );

  const doneCount = milestones.filter((item) => item.done).length;
  const overdue = milestones.filter((item) => !item.done && isOverdue(item.dueDate, todayIso));

  return (
    <div className={styles.wrap}>
      <Sheet className={styles.countdown} tone="stamp" pinned printable={false}>
        <div className={styles.countdownInner}>
          <div>
            <p className={styles.countLabel}>{days >= 0 ? 'Days to go' : 'Days since'}</p>
            <p className={`mono ${styles.countNumber}`}>{Math.abs(days)}</p>
            <p className={styles.countDate}>{formatPlanDate(plan.brief.date)}</p>
          </div>
          <div className={styles.countSide}>
            <p className={styles.countSideLabel}>
              {doneCount} of {milestones.length} milestones done
            </p>
            <div
              className={styles.countTrack}
              role="progressbar"
              aria-label="Milestones completed"
              aria-valuemin={0}
              aria-valuemax={milestones.length}
              aria-valuenow={doneCount}
            >
              <span
                className={styles.countFill}
                style={{
                  width: `${milestones.length ? (doneCount / milestones.length) * 100 : 0}%`,
                }}
              />
            </div>
            {overdue.length > 0 ? (
              <p className={styles.overdue}>
                {overdue.length} {overdue.length === 1 ? 'task is' : 'tasks are'} past due
              </p>
            ) : (
              <p className={styles.onTrack}>Nothing overdue</p>
            )}
          </div>
        </div>
      </Sheet>

      <Sheet>
        <header className={styles.head}>
          <div>
            <h3 className={styles.title}>Counting down</h3>
            <p className={styles.sub}>
              Working backwards from the day, with the lead times that matter.
            </p>
          </div>
          <div className={styles.actions} data-print="hide">
            <Button size="sm" variant="secondary" onClick={onExportIcs}>
              Export calendar
            </Button>
            {icsUrl ? (
              <LinkButton size="sm" variant="ghost" href={icsUrl} download="fete-timeline.ics">
                Download .ics
              </LinkButton>
            ) : null}
          </div>
        </header>

        {milestones.length === 0 ? (
          <EmptyState title="No milestones yet">
            Re-build the timeline from the brief to get a fresh countdown.
          </EmptyState>
        ) : (
          <ol className={styles.tickets}>
            {milestones.map((item, index) => (
              <MilestoneTicket
                key={item.id}
                item={item}
                todayIso={todayIso}
                onToggle={onToggleDone}
                onMove={onMove}
                isFirst={index === 0}
                isLast={index === milestones.length - 1}
              />
            ))}
          </ol>
        )}
      </Sheet>

      <Sheet>
        <header className={styles.head}>
          <div>
            <h3 className={styles.title}>The day itself</h3>
            <p className={styles.sub}>
              An hour-by-hour run sheet. Times are relative to the ceremony or kick-off starting at
              00:00.
            </p>
          </div>
        </header>

        {dayOf.length === 0 ? (
          <EmptyState title="No run sheet yet" />
        ) : (
          <ol className={styles.programme} data-print="columns">
            {dayOf.map((item, index) => (
              <li key={item.id} className={styles.slot}>
                <span className={`mono ${styles.slotTime}`}>
                  {item.startMin !== undefined ? formatMinutesOfDay(item.startMin) : '—'}
                </span>
                <div className={styles.slotBody}>
                  <p className={styles.slotTitle}>{item.title}</p>
                  {item.detail ? <p className={styles.slotDetail}>{item.detail}</p> : null}
                </div>
                <ReorderButtons
                  title={item.title}
                  onMove={(direction) => onMove(item.id, direction)}
                  isFirst={index === 0}
                  isLast={index === dayOf.length - 1}
                />
              </li>
            ))}
          </ol>
        )}
      </Sheet>

      <Callout tone="info" title="Printing this">
        The print stylesheet hides every control and lays the ledger and run sheet out in columns —
        use your browser&apos;s Print and choose “Save as PDF” for a paper copy.
      </Callout>
    </div>
  );
}

function MilestoneTicket({
  item,
  todayIso,
  onToggle,
  onMove,
  isFirst,
  isLast,
}: {
  item: TimelineItem;
  todayIso: string;
  onToggle: (id: string) => void;
  onMove: (id: string, direction: MoveDirection) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const late = !item.done && isOverdue(item.dueDate, todayIso);
  const days = item.dueDate ? daysBetween(todayIso, item.dueDate) : undefined;

  return (
    <li
      className={[styles.ticket, item.done ? styles.ticketDone : '', late ? styles.ticketLate : '']
        .filter(Boolean)
        .join(' ')}
      data-print="avoid-break"
    >
      <label className={styles.ticketCheck}>
        <input
          type="checkbox"
          checked={item.done}
          aria-label={`Mark “${item.title}” as ${item.done ? 'not done' : 'done'}`}
          onChange={() => onToggle(item.id)}
          data-print="hide"
        />
        <span className={styles.checkBox} aria-hidden="true">
          {item.done ? '✓' : ''}
        </span>
      </label>

      <div className={styles.ticketBody}>
        <p className={styles.ticketTitle}>{item.title}</p>
        {item.detail ? <p className={styles.ticketDetail}>{item.detail}</p> : null}
        <div className={styles.ticketMeta}>
          {item.dueDate ? (
            <span className={`mono ${styles.ticketDate}`}>{formatPlanDate(item.dueDate)}</span>
          ) : null}
          {days !== undefined ? (
            <span className={styles.ticketDays}>
              {days === 0 ? 'today' : days > 0 ? `in ${days} days` : `${Math.abs(days)} days late`}
            </span>
          ) : null}
          {item.compressed ? (
            <Stamp
              tone="warn"
              small
              title="Pulled forward: the natural lead time had already passed"
            >
              Compressed
            </Stamp>
          ) : null}
          {late ? (
            <Stamp tone="danger" small>
              Overdue
            </Stamp>
          ) : null}
        </div>
      </div>

      <ReorderButtons
        title={item.title}
        onMove={(direction) => onMove(item.id, direction)}
        isFirst={isFirst}
        isLast={isLast}
      />

      {/* The ticket stub: ruled edge like a torn docket. */}
      <span className={styles.stub} aria-hidden="true" />
    </li>
  );
}

/**
 * Keyboard-first reordering.
 *
 * Two ordinary buttons rather than drag-and-drop: they are reachable by tab,
 * operable by Enter/Space, announced with the item's own title so a screen
 * reader says *which* task is moving, and they need no pointer at all. Drag
 * would have to reimplement all of that, and would be unusable on a phone held
 * one-handed.
 *
 * The buttons are disabled at the ends of the list, so the control never offers
 * a move that would do nothing.
 */
function ReorderButtons({
  title,
  onMove,
  isFirst,
  isLast,
}: {
  title: string;
  onMove: (direction: MoveDirection) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <div className={styles.reorder} data-print="hide">
      <Button
        size="sm"
        variant="ghost"
        className={styles.reorderButton}
        disabled={isFirst}
        aria-label={`Move “${title}” earlier`}
        onClick={() => onMove('up')}
      >
        ↑
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className={styles.reorderButton}
        disabled={isLast}
        aria-label={`Move “${title}” later`}
        onClick={() => onMove('down')}
      >
        ↓
      </Button>
    </div>
  );
}
