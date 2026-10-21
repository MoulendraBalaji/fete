/**
 * The intake "brief": the five-step guided interview that everything else
 * derives from. Validated identically on the client (per-step, via `.pick`)
 * and inside every AI route handler.
 */
import { z } from 'zod';
import {
  boundedText,
  currencySchema,
  eventTypeSchema,
  guestCountSchema,
  isoDateSchema,
  minorUnitsSchema,
  optionalText,
  PLAN_LIMITS,
  prioritySchema,
  TEXT_LIMITS,
} from './core';

export const briefSchema = z
  .object({
    eventType: eventTypeSchema,
    date: isoDateSchema,
    location: boundedText(TEXT_LIMITS.medium, 'Location'),
    guestCount: guestCountSchema,
    budgetMinor: minorUnitsSchema.refine((v) => v > 0, 'Set a budget greater than zero'),
    currency: currencySchema,
    theme: optionalText(TEXT_LIMITS.medium),
    considerations: optionalText(TEXT_LIMITS.long),
    mustHaves: z.array(boundedText(TEXT_LIMITS.short, 'Must-have')).max(PLAN_LIMITS.listItems),
    avoid: z.array(boundedText(TEXT_LIMITS.short, 'Avoid-item')).max(PLAN_LIMITS.listItems),
    priorities: z.array(prioritySchema).max(3),
  })
  .strict();

export type Brief = z.infer<typeof briefSchema>;

/** Field groups per wizard step, used for step-level validation. */
export const INTAKE_STEPS = [
  ['eventType'],
  ['date', 'location'],
  ['guestCount'],
  ['budgetMinor', 'currency'],
  ['theme', 'considerations', 'mustHaves', 'avoid', 'priorities'],
] as const satisfies ReadonlyArray<readonly (keyof Brief)[]>;

export type IntakeStepIndex = 0 | 1 | 2 | 3 | 4;
export const INTAKE_STEP_COUNT = INTAKE_STEPS.length;

/**
 * Validates the fields owned by one wizard step (0-based).
 *
 * Only the step's own keys are taken from `value`: the wizard holds one draft
 * object for all five steps, so validating the whole thing through a `.strict()`
 * shape would reject every field belonging to a *different* step as an
 * unrecognised key. Picking first keeps the strict contract (a step genuinely
 * cannot smuggle in an extra field) while accepting the shared draft.
 */
export function validateStep(
  step: IntakeStepIndex,
  value: unknown,
): { success: true; data: Partial<Brief> } | { success: false; issues: z.core.$ZodIssue[] } {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const key of INTAKE_STEPS[step]) {
    shape[key] = briefSchema.shape[key];
  }

  const source = (value ?? {}) as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of INTAKE_STEPS[step]) {
    picked[key] = source[key];
  }

  const result = z.object(shape).strict().safeParse(picked);
  if (result.success) return { success: true, data: result.data as Partial<Brief> };
  return { success: false, issues: result.error.issues };
}
