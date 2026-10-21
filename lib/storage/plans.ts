/**
 * localStorage repository for plans.
 *
 * Everything is defensive because this is the only persistent store: storage
 * can be absent (private mode, SSR), hold data written by an older version, or
 * have been edited by hand. Reads therefore validate against the schema and
 * migrate forward by version, and a corrupt entry is dropped rather than
 * crashing the workspace.
 *
 * The app works with zero stored plans, so every function tolerates absence.
 */
import { z } from 'zod';
import { PLAN_LIMITS } from '../schemas/core';
import { planSchema, type Plan, type PlanSummary } from '../schemas/plan';

/** The storage envelope carries its own version so migrations are explicit. */
export const STORAGE_VERSION = 1;
export const STORAGE_KEY = 'fete.plans';

/**
 * The envelope carries its own version so migrations are explicit.
 *
 * `plans` is deliberately `z.array(z.unknown())` rather than
 * `z.array(planSchema)`: rows are validated *individually* in
 * `migrateEnvelope` so one hand-edited or older-version row costs only that
 * row, not the entire library. The array cap still bounds the payload.
 */
const envelopeSchema = z
  .object({
    version: z.number().int().min(1).max(STORAGE_VERSION),
    plans: z.array(z.unknown()).max(PLAN_LIMITS.plans),
    /** Last opened plan, so the workspace can restore context. */
    activeId: z.string().max(64).nullable().default(null),
  })
  .strict();

export type StoredEnvelope = {
  version: number;
  plans: Plan[];
  activeId: string | null;
};

/** Minimal storage interface so tests can supply a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const EMPTY_ENVELOPE: StoredEnvelope = { version: STORAGE_VERSION, plans: [], activeId: null };

/** Reads and validates the envelope; never throws. */
export function readEnvelope(storage: StorageLike | undefined): StoredEnvelope {
  if (!storage) return EMPTY_ENVELOPE;
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY_ENVELOPE;
  }
  if (!raw) return EMPTY_ENVELOPE;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_ENVELOPE;
  }

  const envelope = migrateEnvelope(parsed);
  return envelope ?? EMPTY_ENVELOPE;
}

/**
 * Migration chain. v1 is the first shipped shape; when the plan schema evolves,
 * add a `toV2` step here and extend `STORAGE_VERSION`, keeping old data usable.
 * Unknown/newer versions are rejected (the caller shows an empty library rather
 * than corrupting anything).
 */
export function migrateEnvelope(value: unknown): StoredEnvelope | undefined {
  const version = (value as { version?: unknown })?.version;
  if (typeof version !== 'number' || version < 1 || version > STORAGE_VERSION) return undefined;
  const result = envelopeSchema.safeParse(value);
  if (!result.success) return undefined;

  // Validate each row on its own so one bad plan cannot take the library down.
  const plans: Plan[] = [];
  for (const row of result.data.plans) {
    const plan = planSchema.safeParse(row);
    if (plan.success) plans.push(plan.data);
  }

  // Keep `activeId` only when it still points at a surviving plan.
  const activeId = plans.some((plan) => plan.id === result.data.activeId)
    ? result.data.activeId
    : null;
  return { version: result.data.version, plans, activeId };
}

/** Writes the envelope, silently ignoring quota/availability failures. */
export function writeEnvelope(storage: StorageLike | undefined, envelope: StoredEnvelope): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    // Quota exceeded or storage disabled: the in-memory state stays authoritative.
    return false;
  }
}

/** All stored plans, newest first. */
export function listPlans(storage: StorageLike | undefined): Plan[] {
  const envelope = readEnvelope(storage);
  return [...envelope.plans].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Summary rows for the plan library (no heavy fields). */
export function listPlanSummaries(storage: StorageLike | undefined): PlanSummary[] {
  return listPlans(storage).map((plan) => ({
    id: plan.id,
    name: plan.name,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    eventType: plan.brief.eventType,
    date: plan.brief.date,
  }));
}

export function getPlan(storage: StorageLike | undefined, id: string): Plan | undefined {
  return readEnvelope(storage).plans.find((plan) => plan.id === id);
}

/** Inserts or replaces a plan, returning the new envelope. */
export function upsertPlan(storage: StorageLike | undefined, plan: Plan): StoredEnvelope {
  const envelope = readEnvelope(storage);
  const plans = envelope.plans.filter((candidate) => candidate.id !== plan.id);
  plans.unshift(plan);
  const next: StoredEnvelope = {
    version: STORAGE_VERSION,
    plans: plans.slice(0, PLAN_LIMITS.plans),
    activeId: plan.id,
  };
  writeEnvelope(storage, next);
  return next;
}

export function deletePlan(storage: StorageLike | undefined, id: string): StoredEnvelope {
  const envelope = readEnvelope(storage);
  const next: StoredEnvelope = {
    ...envelope,
    plans: envelope.plans.filter((plan) => plan.id !== id),
    activeId: envelope.activeId === id ? null : envelope.activeId,
  };
  writeEnvelope(storage, next);
  return next;
}

export function setActiveId(storage: StorageLike | undefined, id: string | null): void {
  const envelope = readEnvelope(storage);
  writeEnvelope(storage, { ...envelope, activeId: id });
}

/** Replaces the whole library — used by "import JSON" (already validated). */
export function replaceAll(
  storage: StorageLike | undefined,
  plans: readonly Plan[],
): StoredEnvelope {
  const next: StoredEnvelope = {
    version: STORAGE_VERSION,
    plans: plans.slice(0, PLAN_LIMITS.plans),
    activeId: plans[0]?.id ?? null,
  };
  writeEnvelope(storage, next);
  return next;
}

/** Browser storage, or undefined during SSR / when unavailable. */
export function browserStorage(): StorageLike | undefined {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return undefined;
    return window.localStorage;
  } catch {
    return undefined;
  }
}
