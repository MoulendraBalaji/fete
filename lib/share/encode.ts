/**
 * Shareable, read-only plan links.
 *
 * The plan is compressed with lz-string's URI-safe encoding and placed in the
 * URL *hash*. A hash is never sent to the server, so a shared plan does not
 * appear in any access log, and no database is required to share.
 *
 * Hard size cap: browsers and chat apps truncate very long URLs, so we refuse
 * to produce a link beyond `MAX_SHARE_CHARS` and the UI explains why (the
 * export-JSON route is always available instead).
 */
import LZString from 'lz-string';
import { PLAN_LIMITS } from '../schemas/core';
import { planSchema, type Plan } from '../schemas/plan';

/** Conservative ceiling for a whole shareable URL (~8 KB is the common limit). */
export const MAX_SHARE_CHARS = 7_000;
export const SHARE_HASH_PREFIX = '#plan=';

/**
 * Ceiling on decompressed JSON, checked *before* `JSON.parse`.
 *
 * lz-string's ratio is unbounded — a 5 KB run of one character expands to 5 MB
 * in single-digit milliseconds, and `decompressFromEncodedURIComponent` cannot
 * be interrupted once started. Bounding the input length alone is not enough
 * (that same 5 MB payload arrives in 5.6 KB of input), so the decompressed
 * string is measured and rejected before it is ever parsed or validated.
 *
 * 64 KB is roughly 4x the largest plan this app can produce, so a legitimate
 * share of any size still decodes.
 */
export const MAX_DECOMPRESSED_CHARS = 64_000;

/** Row-count ceilings, applied before schema validation walks the arrays. */
const MAX_ROWS = {
  timeline: PLAN_LIMITS.timelineItems,
  vendors: PLAN_LIMITS.vendors,
  ideas: PLAN_LIMITS.ideas,
  budget: PLAN_LIMITS.budgetCategories,
} as const;

export type ShareResult =
  | { ok: true; value: string; chars: number; fidelity: Fidelity }
  | { ok: false; reason: 'too_large' };

/**
 * Sharing degrades in documented steps rather than failing outright.
 *
 * Step 0 is lossless: private + regenerable fields (vendor contact notes, the
 * cached AI question/red-flag answers, dismissed ideas, offline flags) are
 * dropped — they carry no value for a reader and `notes` can hold personal
 * contact details.
 *
 * If the compressed payload is still too large, the shedding ladder trims the
 * longest prose next, longest text first, so a plan whose *structure* matters
 * (dates, money, vendors, task titles) always fits while descriptive detail is
 * what gives way. `shed` records what was removed so the UI can say so.
 */
export type Fidelity = 'full' | 'trimmed_detail' | 'compact';

interface Candidate {
  fidelity: Fidelity;
  payload: unknown;
}

export function encodePlan(plan: Plan): ShareResult {
  const parsed = planSchema.safeParse(plan);
  if (!parsed.success) return { ok: false, reason: 'too_large' };

  for (const candidate of shareCandidates(parsed.data)) {
    const value = LZString.compressToEncodedURIComponent(JSON.stringify(candidate.payload));
    if (value.length <= MAX_SHARE_CHARS) {
      return { ok: true, value, chars: value.length, fidelity: candidate.fidelity };
    }
  }
  return { ok: false, reason: 'too_large' };
}

/** Ordered from highest to lowest fidelity; the first that fits wins. */
function shareCandidates(plan: Plan): Candidate[] {
  const base = trimmedForSharing(plan);
  const trimmedDetail: Plan = {
    ...base,
    timeline: {
      items: base.timeline.items.map((item) => ({ ...item, detail: '' })),
    },
  };
  const compact: Plan = {
    ...trimmedDetail,
    ideas: trimmedDetail.ideas.map((idea) => ({ ...idea, body: '' })),
  };

  return [
    { fidelity: 'full', payload: base },
    { fidelity: 'trimmed_detail', payload: trimmedDetail },
    { fidelity: 'compact', payload: compact },
  ];
}

/**
 * Decodes a share string back into a validated plan.
 *
 * Guard order matters and is the point of this function:
 *   1. bound the *encoded* length (cheap, rejects the obviously huge),
 *   2. decompress,
 *   3. bound the *decompressed* length before parsing (catches a bomb that
 *      arrived inside a small string),
 *   4. reject oversized row counts before the schema walks them,
 *   5. validate with zod, which remains the authority on shape.
 */
export function decodePlan(encoded: string): Plan | undefined {
  if (encoded.length === 0 || encoded.length > MAX_SHARE_CHARS * 2) return undefined;

  let json: string | null;
  try {
    json = LZString.decompressFromEncodedURIComponent(encoded);
  } catch {
    return undefined;
  }
  if (!json) return undefined;

  // Step 3: the decompression-bomb gate. Nothing below runs on a payload that
  // exceeds the ceiling, so no parser ever touches the expanded string.
  if (json.length > MAX_DECOMPRESSED_CHARS) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }

  if (!withinRowLimits(parsed)) return undefined;

  const result = planSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

/**
 * Row-count guard applied before schema validation.
 *
 * The schema enforces these too, but it does so by iterating every element
 * first; this rejects a 50,000-element array without building 50,000 errors.
 * Unknown or absent collections are left for the schema to judge, so this can
 * only ever reject, never accidentally accept.
 */
function withinRowLimits(candidate: unknown): boolean {
  if (!candidate || typeof candidate !== 'object') return true;
  const plan = candidate as Record<string, unknown>;

  const arrays: ReadonlyArray<[unknown, number]> = [
    [(plan.timeline as { items?: unknown } | undefined)?.items, MAX_ROWS.timeline],
    [plan.vendors, MAX_ROWS.vendors],
    [plan.ideas, MAX_ROWS.ideas],
    [(plan.budget as { rows?: unknown } | undefined)?.rows, MAX_ROWS.budget],
  ];

  return arrays.every(([value, max]) => !Array.isArray(value) || value.length <= max);
}

/** Full shareable path for a plan, or a reason why it cannot be shared by URL. */
export function buildSharePath(plan: Plan): ShareResult {
  const encoded = encodePlan(plan);
  if (!encoded.ok) return encoded;
  return {
    ok: true,
    value: `${SHARE_HASH_PREFIX}${encoded.value}`,
    chars: encoded.chars,
    fidelity: encoded.fidelity,
  };
}

/** Reads a plan out of a `location.hash`-style string, if present. */
export function readPlanFromHash(hash: string): Plan | undefined {
  if (!hash.startsWith(SHARE_HASH_PREFIX)) return undefined;
  return decodePlan(hash.slice(SHARE_HASH_PREFIX.length));
}

/**
 * Step 0 of sharing: drops volatile, oversized and private fields.
 *
 * - `notes` can hold personal contact details, so they never leave the device.
 * - `questions` / `redFlags` are a *cache* of AI answers, not plan content;
 *   they are regenerable and the shared reader cannot use them.
 * - dismissed ideas are hidden by definition, and `offlineSections` is local
 *   telemetry.
 *
 * Every dropped field has a schema default, so the payload still validates when
 * it is decoded on the other side.
 */
function trimmedForSharing(plan: Plan): Plan {
  return {
    ...plan,
    vendors: plan.vendors.map((vendor) => ({
      ...vendor,
      notes: '',
      questions: [],
      redFlags: [],
    })),
    ideas: plan.ideas.filter((idea) => !idea.dismissed),
    offlineSections: [],
  };
}

/** Serialises a plan for the "export JSON" download. */
export function toExportJson(plan: Plan): string {
  return JSON.stringify({ app: 'fete', version: 1, plan }, null, 2);
}

export type ImportResult =
  { ok: true; plan: Plan } | { ok: false; reason: 'invalid_json' | 'invalid_plan' };

/** Parses an exported file (or a pasted plan) with schema validation + size cap. */
export function fromImportJson(text: string, maxChars = 512_000): ImportResult {
  if (text.length > maxChars) return { ok: false, reason: 'invalid_json' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  const candidate =
    parsed && typeof parsed === 'object' && 'plan' in parsed
      ? (parsed as { plan: unknown }).plan
      : parsed;
  const result = planSchema.safeParse(candidate);
  if (!result.success) return { ok: false, reason: 'invalid_plan' };
  return { ok: true, plan: result.data };
}
