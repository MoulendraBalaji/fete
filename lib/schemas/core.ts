/**
 * Core primitives shared by every schema in the app.
 *
 * Design notes:
 * - Money is always an integer count of the currency's minor unit (paise, cents,
 *   yen). Floating point never touches monetary values anywhere in the codebase.
 * - Every text field is length-capped here so client and server reject the exact
 *   same payloads; the API layer additionally caps the raw body size.
 * - Schemas are the single source of truth: TS types are `z.infer`red from them.
 */
import { z } from 'zod';

/** Hard ceilings for free-text input (characters). */
export const TEXT_LIMITS = {
  short: 80,
  medium: 160,
  long: 320,
  chatMessage: 1000,
  chatContext: 4000,
} as const;

/** Caps that keep a stored plan small enough to survive URL-share encoding. */
export const PLAN_LIMITS = {
  name: 80,
  listItems: 8,
  timelineItems: 80,
  vendors: 40,
  ideas: 40,
  budgetCategories: 20,
  plans: 25,
  /** Milestone detail lines are prompt-fed, so they stay tight. */
  timelineDetail: 220,
  /** Per-vendor AI notes. */
  vendorNotes: 280,
  /** Counts inside a plan array. */
  questionsPerVendor: 6,
  redFlagsPerVendor: 4,
} as const;

/** Sanity ceiling for a total budget: 1,000,000,000 in 2-decimal currency. */
export const MAX_BUDGET_MINOR = 100_000_000_00;
export const MAX_GUESTS = 100_000;

export const EVENT_TYPES = ['wedding', 'birthday', 'community'] as const;
export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;

export const IDEA_KINDS = [
  'theme',
  'menu',
  'activity',
  'decor',
  'favor',
  'volunteer',
  'outreach',
  'other',
] as const;
export const ideaKindSchema = z.enum(IDEA_KINDS);
export type IdeaKind = z.infer<typeof ideaKindSchema>;

export const COST_TIERS = ['free', 'low', 'mid', 'high'] as const;
export const costTierSchema = z.enum(COST_TIERS);
export type CostTier = z.infer<typeof costTierSchema>;

export const VENDOR_STATUSES = ['todo', 'contacted', 'quoted', 'booked', 'paid'] as const;
export const vendorStatusSchema = z.enum(VENDOR_STATUSES);
export type VendorStatus = z.infer<typeof vendorStatusSchema>;

export const TIMELINE_PHASES = ['milestone', 'dayof'] as const;
export const timelinePhaseSchema = z.enum(TIMELINE_PHASES);
export type TimelinePhase = z.infer<typeof timelinePhaseSchema>;

export const AI_SECTIONS = ['ideas', 'vendorTips', 'budgetAdvice'] as const;
export const aiSectionSchema = z.enum(AI_SECTIONS);
export type AiSection = z.infer<typeof aiSectionSchema>;

/** How much of the total budget the planner should protect as contingency. */
export const PRIORITY_OPTIONS = [
  'food',
  'music',
  'photos',
  'decor',
  'attire',
  'guest-experience',
  'value',
] as const;
export const prioritySchema = z.enum(PRIORITY_OPTIONS);
export type Priority = z.infer<typeof prioritySchema>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar-valid `YYYY-MM-DD` date (rejects 2025-02-30 etc.). */
export const isoDateSchema = z
  .string()
  .regex(ISO_DATE_RE, 'Use the format YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'That is not a real calendar date');

/** ISO 4217 alphabetic currency code, e.g. USD, EUR, INR. */
export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter code such as USD');

/** Lowercase kebab identifier used for budget/vendor category keys. */
export const categoryKeySchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, 'Unknown category key');

/** Opaque, URL-safe record id. */
export const recordIdSchema = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/, 'Invalid id');

/** Bounded, trimmed, non-empty text. */
export const boundedText = (max: number, label: string) =>
  z.string().trim().min(1, `${label} is needed`).max(max, `Keep ${label} under ${max} characters`);

/** Bounded, optional text (empty string allowed). */
export const optionalText = (max: number) => z.string().trim().max(max);

/** Positive integer money amount in minor units. */
export const minorUnitsSchema = z
  .number()
  .int('Use whole minor units')
  .min(0)
  .max(MAX_BUDGET_MINOR);

export const guestCountSchema = z
  .number()
  .int('Guest count must be a whole number')
  .min(1, 'Plan for at least one guest')
  .max(MAX_GUESTS, 'That guest count is beyond what this planner supports');
