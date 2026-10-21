/**
 * The Ledger — deterministic budget allocation.
 *
 * Pipeline: template weights → guest-count adjustment → priority boost →
 * normalise weights to whole basis points (largest remainder) → allocate the
 * total in minor units (largest remainder again). Contingency is reserved
 * before anything else and can never fall below CONTINGENCY_FLOOR_BPS.
 *
 * The AI never writes to this module: it may propose transfers (percent of
 * total), but only the user's explicit accept changes a number.
 *
 * Pure — no I/O, no React, no Date.now() (callers pass the brief in).
 */
import type { EventType, Priority } from '../schemas/core';
import type { Brief } from '../schemas/brief';
import type { BudgetRow } from '../schemas/plan';
import { allocate, sum } from './money';

/** One line of the ledger template. Weights are basis points (1 % = 100). */
export interface BudgetCategory {
  key: string;
  label: string;
  /** One-line explanation shown under the label in the Ledger. */
  hint: string;
  weightBps: number;
  /** Share grows with guest count (catering-style costs). */
  guestSensitive?: boolean;
  /** Contingency reserve — always allocated first, never user-deletable. */
  contingency?: boolean;
}

export type BudgetTemplate = readonly BudgetCategory[];

/** Contingency can never drop below 5 % nor exceed 15 % of the total. */
export const CONTINGENCY_FLOOR_BPS = 500;
export const CONTINGENCY_CAP_BPS = 1500;
const CONTINGENCY_ADJUST_BPS = 200;
/** Multiplicative boost applied to categories a stated priority maps onto. */
const PRIORITY_BOOST = 1.3;
/** "Value" priority trims discretionary shares and grows the reserve instead. */
const VALUE_TRIM = 0.95;
/** Guest-count scaling: 100 guests = neutral, clamped to [0.6, 1.9]. */
const GUEST_REFERENCE = 100;
const GUEST_FACTOR_MIN = 0.6;
const GUEST_FACTOR_MAX = 1.9;

/** Priorities → the category keys they should protect when trimming happens. */
const PRIORITY_CATEGORY_KEYS: Readonly<Record<Priority, readonly string[]>> = {
  food: ['catering', 'food-drink', 'cake'],
  music: ['entertainment', 'program-entertainment'],
  photos: ['photography', 'documentation'],
  decor: ['decor'],
  attire: ['attire'],
  'guest-experience': ['venue', 'venue-permits', 'accessibility', 'logistics'],
  value: [],
};

const WEDDING: BudgetTemplate = [
  { key: 'venue', label: 'Venue', hint: 'Hire, site fees and service charges', weightBps: 1700 },
  {
    key: 'catering',
    label: 'Food & drink',
    hint: 'Per-head menu, bar and cake cutting',
    weightBps: 2300,
    guestSensitive: true,
  },
  {
    key: 'attire',
    label: 'Attire',
    hint: 'Outfits, alterations, shoes, accessories',
    weightBps: 700,
  },
  {
    key: 'photography',
    label: 'Photography',
    hint: 'Photographer, video and albums',
    weightBps: 1100,
  },
  {
    key: 'entertainment',
    label: 'Music & entertainment',
    hint: 'Band, DJ, ceremony musicians',
    weightBps: 850,
  },
  {
    key: 'decor',
    label: 'Flowers & decor',
    hint: 'Bouquets, centrepieces, signage, lighting',
    weightBps: 850,
  },
  {
    key: 'stationery',
    label: 'Invitations & stationery',
    hint: 'Save-the-dates, invites, menus, place cards',
    weightBps: 350,
  },
  {
    key: 'transport',
    label: 'Transport & stay',
    hint: 'Cars, shuttles, guest hotel block',
    weightBps: 450,
  },
  {
    key: 'favours',
    label: 'Favours & gifts',
    hint: 'Guest keepsakes and wedding-party gifts',
    weightBps: 350,
  },
  {
    key: 'planning-support',
    label: 'Planning support',
    hint: 'Coordinator, officiant, hair & makeup',
    weightBps: 550,
  },
  {
    key: 'contingency',
    label: 'Contingency',
    hint: 'Reserved for surprises — spend only what you must',
    weightBps: 800,
    contingency: true,
  },
];

const BIRTHDAY: BudgetTemplate = [
  { key: 'venue', label: 'Space', hint: 'Venue hire or home setup & permits', weightBps: 1600 },
  {
    key: 'catering',
    label: 'Food & drink',
    hint: 'Mains, snacks and drinks per head',
    weightBps: 3000,
    guestSensitive: true,
  },
  {
    key: 'cake',
    label: 'Cake & sweets',
    hint: 'Celebration cake and dessert table',
    weightBps: 500,
    guestSensitive: true,
  },
  {
    key: 'decor',
    label: 'Decor & theme',
    hint: 'Balloons, banners, table settings',
    weightBps: 1400,
  },
  {
    key: 'entertainment',
    label: 'Entertainment',
    hint: 'DJ, games, activities, performer',
    weightBps: 1100,
  },
  {
    key: 'photography',
    label: 'Photography',
    hint: 'Camera hire or a friend with a brief',
    weightBps: 700,
  },
  { key: 'invitations', label: 'Invitations', hint: 'Cards, printing, postage', weightBps: 300 },
  {
    key: 'favours',
    label: 'Party favours',
    hint: 'Thank-you bags and goody boxes',
    weightBps: 500,
  },
  {
    key: 'logistics',
    label: 'Logistics',
    hint: 'Transport, rentals, cleanup supplies',
    weightBps: 400,
  },
  {
    key: 'contingency',
    label: 'Contingency',
    hint: 'Reserved for surprises — spend only what you must',
    weightBps: 500,
    contingency: true,
  },
];

const COMMUNITY: BudgetTemplate = [
  {
    key: 'venue-permits',
    label: 'Venue & permits',
    hint: 'Site hire, council permits, insurance',
    weightBps: 1700,
  },
  {
    key: 'food-drink',
    label: 'Food & drink',
    hint: 'Serving volunteers and guests well',
    weightBps: 2900,
    guestSensitive: true,
  },
  {
    key: 'program-entertainment',
    label: 'Program & stage',
    hint: 'Performers, speakers, MC, activities',
    weightBps: 1300,
  },
  {
    key: 'marketing-outreach',
    label: 'Outreach & print',
    hint: 'Posters, flyers, social ads, translations',
    weightBps: 900,
  },
  {
    key: 'equipment-rentals',
    label: 'Equipment & rentals',
    hint: 'Tents, tables, PA, lighting, signage',
    weightBps: 1000,
  },
  {
    key: 'volunteer-support',
    label: 'Volunteer support',
    hint: 'Shirts, meals, training, first aid',
    weightBps: 600,
  },
  {
    key: 'accessibility',
    label: 'Access & inclusion',
    hint: 'Step-free routes, interpreters, quiet space',
    weightBps: 700,
  },
  {
    key: 'documentation',
    label: 'Documentation',
    hint: 'Photography and post-event report',
    weightBps: 400,
  },
  {
    key: 'contingency',
    label: 'Contingency',
    hint: 'Reserved for surprises — spend only what you must',
    weightBps: 500,
    contingency: true,
  },
];

export const BUDGET_TEMPLATES: Readonly<Record<EventType, BudgetTemplate>> = {
  wedding: WEDDING,
  birthday: BIRTHDAY,
  community: COMMUNITY,
};

export function budgetTemplateFor(eventType: EventType): BudgetTemplate {
  return BUDGET_TEMPLATES[eventType] ?? [];
}
/** Guest-count multiplier for guest-sensitive categories (clamped, never NaN). */
function guestFactor(guestCount: number): number {
  if (!Number.isFinite(guestCount) || guestCount <= 0) return 1;
  const raw = guestCount / GUEST_REFERENCE;
  return Math.min(GUEST_FACTOR_MAX, Math.max(GUEST_FACTOR_MIN, raw));
}

/** Contingency share for a brief, clamped to the floor/cap band. */
function contingencyBpsFor(brief: Pick<Brief, 'priorities' | 'eventType'>): number {
  const template = budgetTemplateFor(brief.eventType).find((category) => category.contingency);
  const base = template?.weightBps ?? CONTINGENCY_FLOOR_BPS;
  const adjusted = brief.priorities.includes('value') ? base + CONTINGENCY_ADJUST_BPS : base;
  return Math.min(CONTINGENCY_CAP_BPS, Math.max(CONTINGENCY_FLOOR_BPS, adjusted));
}

/** Final per-category basis points for a brief; sums to exactly 10 000. */
export function weightsForBrief(brief: Brief): number[] {
  const template = budgetTemplateFor(brief.eventType);
  const contingencyBps = contingencyBpsFor(brief);
  const factor = guestFactor(brief.guestCount);
  const wantsValue = brief.priorities.includes('value');

  const variableWeights = template.map((category) => {
    if (category.contingency) return 0;
    let weight = category.weightBps;
    if (category.guestSensitive) weight *= factor;
    if (
      brief.priorities.some((priority) => PRIORITY_CATEGORY_KEYS[priority].includes(category.key))
    ) {
      weight *= PRIORITY_BOOST;
    }
    if (wantsValue) weight *= VALUE_TRIM;
    // Every non-contingency line keeps a visible share (>= 1 basis point).
    return Math.max(weight, 1);
  });

  const variableBudgetBps = 10_000 - contingencyBps;
  const variableBps = allocate(variableBudgetBps, variableWeights);

  let variableIndex = 0;
  return template.map((category) => {
    if (category.contingency) return contingencyBps;
    const value = variableBps[variableIndex] ?? 0;
    variableIndex += 1;
    return value;
  });
}

export interface LedgerRow {
  key: string;
  label: string;
  hint: string;
  shareBps: number;
  plannedMinor: number;
  actualMinor: number;
  contingency: boolean;
}

export interface Ledger {
  rows: LedgerRow[];
  totalMinor: number;
  plannedTotalMinor: number;
  actualTotalMinor: number;
  /** Total − planned: negative means over-allocated (flagged in the UI). */
  unallocatedMinor: number;
  /** Planned − actual: money still available in the envelope. */
  remainingMinor: number;
  contingencyMinor: number;
}

/** Fresh budget rows for a brief — the "planned" column of the Ledger. */
export function initialBudgetRows(
  brief: Brief,
  actualByKey: Readonly<Record<string, number>> = {},
): BudgetRow[] {
  const template = budgetTemplateFor(brief.eventType);
  const weights = weightsForBrief(brief);
  const planned = allocate(brief.budgetMinor, weights);
  return template.map((category, index) => ({
    key: category.key,
    plannedMinor: planned[index] ?? 0,
    actualMinor: Math.max(0, actualByKey[category.key] ?? 0),
  }));
}

/**
 * Derives the display Ledger for a brief + stored rows.
 * Unknown keys are dropped; categories missing from storage are re-seeded from
 * the engine, so imported/legacy plans always render a complete, coherent table.
 */
export function computeLedger(brief: Brief, storedRows: readonly BudgetRow[]): Ledger {
  const template = budgetTemplateFor(brief.eventType);
  const seeded = initialBudgetRows(
    brief,
    Object.fromEntries(storedRows.map((row) => [row.key, row.actualMinor])),
  );
  const storedByKey = new Map(storedRows.map((row) => [row.key, row]));

  const rows: LedgerRow[] = template.map((category, index) => {
    const seed = seeded[index] ?? { key: category.key, plannedMinor: 0, actualMinor: 0 };
    const stored = storedByKey.get(category.key);
    return {
      key: category.key,
      label: category.label,
      hint: category.hint,
      shareBps: 0,
      plannedMinor: stored?.plannedMinor ?? seed.plannedMinor,
      actualMinor: stored?.actualMinor ?? seed.actualMinor,
      contingency: Boolean(category.contingency),
    };
  });

  // Re-derive each row's share of the total so displayed percentages always
  // agree with displayed amounts (edits included).
  const plannedTotalMinor = sum(rows.map((row) => row.plannedMinor));
  const withShares = rows.map((row) => ({
    ...row,
    shareBps:
      brief.budgetMinor > 0 ? Math.round((row.plannedMinor / brief.budgetMinor) * 10_000) : 0,
  }));

  const actualTotalMinor = sum(rows.map((row) => row.actualMinor));
  const contingencyRow = withShares.find((row) => row.contingency);

  return {
    rows: withShares,
    totalMinor: brief.budgetMinor,
    plannedTotalMinor,
    actualTotalMinor,
    unallocatedMinor: brief.budgetMinor - plannedTotalMinor,
    remainingMinor: plannedTotalMinor - actualTotalMinor,
    contingencyMinor: contingencyRow?.plannedMinor ?? 0,
  };
}

/**
 * Applies a percent-of-total transfer suggestion. Returns new rows whose
 * planned amounts still sum to the same total (or the unchanged input when the
 * transfer would be invalid, e.g. from a category that cannot cover it).
 */
export function applyTransfer(
  rows: readonly BudgetRow[],
  totalMinor: number,
  transfer: { from: string; to: string; percentOfTotal: number },
): BudgetRow[] {
  const from = rows.find((row) => row.key === transfer.from);
  const to = rows.find((row) => row.key === transfer.to);
  if (!from || !to || from.key === to.key) return [...rows];
  // The reserve is untouchable: suggestions may not drain contingency.
  if (from.key === 'contingency') return [...rows];

  const amount = Math.round((totalMinor * transfer.percentOfTotal) / 100);
  if (amount <= 0 || from.plannedMinor < amount) return [...rows];

  return rows.map((row) => {
    if (row.key === from.key) return { ...row, plannedMinor: row.plannedMinor - amount };
    if (row.key === to.key) return { ...row, plannedMinor: row.plannedMinor + amount };
    return row;
  });
}
