/**
 * Plan assembly — the pure functions that turn a brief into a complete plan
 * and keep one consistent when the brief changes.
 *
 * Rebuild policy (documented because it is a product decision):
 * - Budget: any brief change re-derives *planned* amounts from the engine;
 *   *actual* spend is always preserved, because history never changes.
 * - Timeline: rebuilt only when the date or event type changed; `done` flags
 *   survive when the milestone ids match (same event type).
 * - Vendors and ideas are never touched by a brief edit.
 *
 * Pure — callers inject `now` / `todayIso`.
 */
import type { Brief } from '../schemas/brief';
import type { Plan, TimelineItem } from '../schemas/plan';
import { initialBudgetRows } from './budget';
import { newId } from './id';
import { generateTimeline } from './timeline';
import { createRoster } from './vendors';

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const EVENT_TYPE_LABELS: Readonly<Record<Brief['eventType'], string>> = {
  wedding: 'Wedding',
  birthday: 'Birthday',
  community: 'Community event',
};

/** "12 Jun 2026" — fixed English abbreviations keep names deterministic. */
export function formatPlanDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const monthLabel = MONTHS_SHORT[Number(month) - 1] ?? '';
  if (!year || !monthLabel || !day) return isoDate;
  return `${Number(day)} ${monthLabel} ${year}`;
}

/** Sensible first plan name: "Wedding · Lisbon · 12 Jun 2026". */
export function defaultPlanName(brief: Brief): string {
  const type = EVENT_TYPE_LABELS[brief.eventType];
  const place = brief.location.trim();
  return `${type} · ${place} · ${formatPlanDate(brief.date)}`.slice(0, 80);
}

export interface CreatePlanOptions {
  id?: string;
  now?: number;
  todayIso?: string;
}

/** Builds a complete plan (budget, timeline, roster) from a validated brief. */
export function createPlan(brief: Brief, options: CreatePlanOptions = {}): Plan {
  const todayIso = options.todayIso ?? new Date().toISOString().slice(0, 10);
  const now = options.now ?? Date.now();

  return {
    id: options.id ?? newId(),
    name: defaultPlanName(brief),
    createdAt: now,
    updatedAt: now,
    brief,
    budget: { rows: initialBudgetRows(brief) },
    timeline: { items: generateTimeline(brief.eventType, brief.date, todayIso) },
    vendors: createRoster(brief.eventType),
    ideas: [],
    offlineSections: [],
  };
}

/** Re-derives budget + (conditionally) timeline after the brief was edited. */
export function rebuildPlan(plan: Plan, brief: Brief, todayIso: string): Plan {
  const previousBrief = plan.brief;
  const dateChanged = previousBrief.date !== brief.date;
  const typeChanged = previousBrief.eventType !== brief.eventType;

  const actualByKey = Object.fromEntries(plan.budget.rows.map((row) => [row.key, row.actualMinor]));

  let items: TimelineItem[] = plan.timeline.items;
  if (dateChanged || typeChanged) {
    const doneIds = new Set(
      typeChanged ? [] : plan.timeline.items.filter((item) => item.done).map((item) => item.id),
    );
    items = generateTimeline(brief.eventType, brief.date, todayIso).map((item) =>
      doneIds.has(item.id) ? { ...item, done: true } : item,
    );
  }

  return {
    ...plan,
    brief,
    budget: { rows: initialBudgetRows(brief, actualByKey) },
    timeline: { items },
    // A different event type implies a different roster and idea set.
    vendors: typeChanged ? createRoster(brief.eventType) : plan.vendors,
    ideas: typeChanged ? [] : plan.ideas,
  };
}

/** Deep-enough copy with a new identity — used by "Duplicate". */
export function duplicatePlan(
  plan: Plan,
  options: { id?: string; now?: number; nameSuffix?: string } = {},
): Plan {
  const now = options.now ?? Date.now();
  const suffix = options.nameSuffix ?? ' (copy)';
  return {
    ...structuredClone(plan),
    id: options.id ?? newId(),
    name: `${plan.name}${suffix}`.slice(0, 80),
    createdAt: now,
    updatedAt: now,
  };
}
