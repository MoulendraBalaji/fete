/**
 * The plan aggregate — everything that lives in localStorage and travels
 * through share links, exports and imports. One schema = one source of truth
 * for storage, JSON transfer and URL-share decoding.
 *
 * All collection sizes are capped so a plan can never grow past what the
 * lz-string share hash can carry (see lib/share/encode.ts).
 */
import { z } from 'zod';
import {
  boundedText,
  categoryKeySchema,
  minorUnitsSchema,
  optionalText,
  PLAN_LIMITS,
  recordIdSchema,
  TEXT_LIMITS,
  timelinePhaseSchema,
  vendorStatusSchema,
  ideaKindSchema,
  costTierSchema,
  aiSectionSchema,
  type VendorStatus,
  type IdeaKind,
  type CostTier,
} from './core';
import { briefSchema } from './brief';

export type { VendorStatus, IdeaKind, CostTier };

export const budgetRowSchema = z
  .object({
    key: categoryKeySchema,
    plannedMinor: minorUnitsSchema,
    actualMinor: minorUnitsSchema,
  })
  .strict();
export type BudgetRow = z.infer<typeof budgetRowSchema>;

export const timelineItemSchema = z
  .object({
    id: recordIdSchema,
    /** 'milestone' = dated planning task; 'dayof' = hour-by-hour program slot. */
    phase: timelinePhaseSchema,
    title: boundedText(TEXT_LIMITS.short, 'Task title'),
    detail: optionalText(PLAN_LIMITS.timelineDetail),
    /** Required for milestones. */
    dueDate: z.string().optional(),
    /** Minutes after midnight, required for day-of items. */
    startMin: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 - 1)
      .optional(),
    endMin: z
      .number()
      .int()
      .min(0)
      .max(24 * 60)
      .optional(),
    done: z.boolean(),
    order: z.number().int().min(0).max(9999),
    /** True when the template's natural lead time exceeded the time available. */
    compressed: z.boolean().default(false),
  })
  .strict()
  .refine((item) => (item.phase === 'milestone' ? Boolean(item.dueDate) : true), {
    message: 'Milestones need a due date',
  })
  .refine((item) => (item.phase === 'dayof' ? item.startMin !== undefined : true), {
    message: 'Day-of items need a start time',
  });
export type TimelineItem = z.infer<typeof timelineItemSchema>;

export const vendorSchema = z
  .object({
    id: recordIdSchema,
    categoryKey: categoryKeySchema,
    label: boundedText(TEXT_LIMITS.short, 'Vendor category'),
    name: optionalText(TEXT_LIMITS.medium),
    status: vendorStatusSchema,
    quoteMinor: minorUnitsSchema,
    notes: optionalText(PLAN_LIMITS.vendorNotes),
    /** Budget category this vendor's spend counts against (null = unlinked). */
    budgetKey: categoryKeySchema.nullable(),
    /** Cached AI answers for "questions to ask" + "red flags". */
    questions: z
      .array(boundedText(TEXT_LIMITS.medium, 'Question'))
      .max(PLAN_LIMITS.questionsPerVendor)
      .default([]),
    redFlags: z
      .array(boundedText(TEXT_LIMITS.medium, 'Red flag'))
      .max(PLAN_LIMITS.redFlagsPerVendor)
      .default([]),
    tipsSource: z.enum(['ai', 'seed', 'none']).default('none'),
  })
  .strict();
export type Vendor = z.infer<typeof vendorSchema>;

export const ideaSchema = z
  .object({
    id: recordIdSchema,
    kind: ideaKindSchema,
    title: boundedText(TEXT_LIMITS.short, 'Idea title'),
    body: boundedText(TEXT_LIMITS.long, 'Idea detail'),
    costTier: costTierSchema,
    pinned: z.boolean(),
    dismissed: z.boolean(),
    source: z.enum(['ai', 'seed']),
  })
  .strict();
export type Idea = z.infer<typeof ideaSchema>;

export const planSchema = z
  .object({
    id: recordIdSchema,
    name: boundedText(PLAN_LIMITS.name, 'Plan name'),
    createdAt: z.number().int().min(0),
    updatedAt: z.number().int().min(0),
    brief: briefSchema,
    budget: z
      .object({
        rows: z.array(budgetRowSchema).min(1).max(PLAN_LIMITS.budgetCategories),
      })
      .strict(),
    timeline: z
      .object({ items: z.array(timelineItemSchema).max(PLAN_LIMITS.timelineItems) })
      .strict(),
    vendors: z.array(vendorSchema).max(PLAN_LIMITS.vendors),
    ideas: z.array(ideaSchema).max(PLAN_LIMITS.ideas),
    /** Count of AI responses currently being served from deterministic fallbacks. */
    offlineSections: z.array(aiSectionSchema).default([]),
  })
  .strict();

export type Plan = z.infer<typeof planSchema>;

/** A plan as stored per-row in localStorage (metadata kept outside the plan). */
export type PlanSummary = Pick<Plan, 'id' | 'name' | 'createdAt' | 'updatedAt'> & {
  eventType: Plan['brief']['eventType'];
  date: string;
};
