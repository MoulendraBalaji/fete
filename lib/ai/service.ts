/**
 * The AI service: one place that owns "call the model, validate, repair once,
 * fall back". Route handlers stay thin; components never see a provider.
 *
 * Caching: identical idea requests are answered from a bounded in-memory Map
 * with a TTL. This is per-instance and best-effort (a cold lambda has an empty
 * cache, and several instances do not share), which is why it is only ever a
 * latency optimisation — never a correctness or cost guarantee.
 */
import 'server-only';
import type { z } from 'zod';
import type { Brief } from '../schemas/brief';
import type { BudgetRow } from '../schemas/plan';
import {
  aiBudgetAdviceSchema,
  aiIdeasResponseSchema,
  aiVendorTipsSchema,
  type AiBudgetAdvice,
  type AiIdeasResponse,
  type AiVendorTips,
} from '../schemas/api';
import { fallbackBudgetAdvice, fallbackIdeas, fallbackVendorTips } from './fallbacks';
import { parseStructured, stripCodeFences } from './parse';
import {
  buildBudgetAdvicePrompt,
  buildIdeasPrompt,
  buildRepairPrompt,
  buildVendorTipsPrompt,
  PROMPT_IDS,
} from './prompts';
import type { LlmProvider } from './provider';
import { sanitizeModelText } from '../security/sanitize';

/** Result envelope so callers can label sections as AI or standard. */
export interface AiSectionResult<T> {
  data: T;
  source: 'ai' | 'fallback';
  promptId: string;
}

const IDEA_CACHE_TTL_MS = 10 * 60_000;
const IDEA_CACHE_MAX_ENTRIES = 64;
const TOKEN_BUDGET = { ideas: 900, vendorTips: 420, budgetAdvice: 520 } as const;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ResponseCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  get(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, now = Date.now()): void {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

const ideaCache = new ResponseCache<AiIdeasResponse>(IDEA_CACHE_TTL_MS, IDEA_CACHE_MAX_ENTRIES);

/** Test seam. */
export function resetAiCaches(): void {
  ideaCache.clear();
}

/** Stable, order-independent cache key for a brief + existing titles. */
export function ideaCacheKey(brief: Brief, existingTitles: readonly string[]): string {
  return JSON.stringify({
    b: [
      brief.eventType,
      brief.date,
      brief.location,
      brief.guestCount,
      brief.budgetMinor,
      brief.currency,
      brief.theme,
      brief.considerations,
      [...brief.mustHaves].sort(),
      [...brief.avoid].sort(),
      [...brief.priorities].sort(),
    ],
    e: [...existingTitles].sort().slice(0, 20),
  });
}

/**
 * Runs one structured completion through the full ladder.
 * `schema` must be the exact contract; anything else falls back.
 */
async function callStructured<T>(options: {
  provider: LlmProvider | undefined;
  messages: ReturnType<typeof buildIdeasPrompt>;
  schema: z.ZodType<T>;
  expectedShape: string;
  maxTokens: number;
  promptId: string;
  temperature: number;
}): Promise<T | undefined> {
  const { provider, schema, expectedShape, maxTokens, promptId, messages } = options;
  if (!provider) return undefined;

  try {
    const raw = await provider.complete(messages, {
      maxTokens,
      temperature: options.temperature,
      jsonMode: true,
    });

    const outcome = await parseStructured(raw, schema, async (invalidText) => {
      const repairMessages = buildRepairPrompt(invalidText, expectedShape);
      return provider.complete(repairMessages, {
        maxTokens,
        temperature: 0,
        jsonMode: true,
      });
    });

    if (!outcome.ok) return undefined;
    return cleanIdeaPayload(outcome.value, schema);
  } catch {
    // Any provider failure degrades to the fallback; the route still returns 200
    // with `source: 'fallback'` so the UI can show the gentle notice.
    void promptId;
    return undefined;
  }
}

/**
 * Sanitises every string in a validated payload before it is stored, so fence
 * tokens or control characters from the model never reach the plan (and never
 * re-enter a later prompt).
 */
function cleanIdeaPayload<T>(value: T, schema: z.ZodType<T>): T | undefined {
  const cleaned = mapStrings(value as unknown);
  const result = schema.safeParse(cleaned);
  return result.success ? result.data : undefined;
}

function mapStrings(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeModelText(value);
  if (Array.isArray(value)) return value.map(mapStrings);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      mapStrings(item),
    ]);
    return Object.fromEntries(entries);
  }
  return value;
}

/* --------------------------------- ideas ---------------------------------- */

export async function generateIdeas(
  provider: LlmProvider | undefined,
  brief: Brief,
  existingTitles: readonly string[] = [],
  count = 6,
): Promise<AiSectionResult<AiIdeasResponse>> {
  const key = ideaCacheKey(brief, existingTitles);
  const cached = ideaCache.get(key);
  if (cached) {
    return { data: cached, source: 'ai', promptId: PROMPT_IDS.ideas };
  }

  const data = await callStructured({
    provider,
    messages: buildIdeasPrompt({ brief, existingTitles, count }),
    schema: aiIdeasResponseSchema,
    expectedShape:
      '{"ideas":[{"kind":"theme|menu|activity|decor|favor|volunteer|outreach|other","title":"...","body":"...","costTier":"free|low|mid|high"}]}',
    maxTokens: TOKEN_BUDGET.ideas,
    promptId: PROMPT_IDS.ideas,
    temperature: 0.8,
  });

  if (data) {
    ideaCache.set(key, data);
    return { data, source: 'ai', promptId: PROMPT_IDS.ideas };
  }
  return {
    data: { ideas: fallbackIdeas(brief, count) },
    source: 'fallback',
    promptId: PROMPT_IDS.ideas,
  };
}

/* ------------------------------- vendor tips ------------------------------- */

export async function generateVendorTips(
  provider: LlmProvider | undefined,
  brief: Brief,
  categoryKey: string,
): Promise<AiSectionResult<AiVendorTips>> {
  const data = await callStructured({
    provider,
    messages: buildVendorTipsPrompt({ brief, categoryKey }),
    schema: aiVendorTipsSchema,
    expectedShape: '{"questions":["..."],"redFlags":["..."]}',
    maxTokens: TOKEN_BUDGET.vendorTips,
    promptId: PROMPT_IDS.vendorTips,
    temperature: 0.5,
  });

  if (data) return { data, source: 'ai', promptId: PROMPT_IDS.vendorTips };
  return {
    data: fallbackVendorTips(brief, categoryKey),
    source: 'fallback',
    promptId: PROMPT_IDS.vendorTips,
  };
}

/* ------------------------------ budget advice ------------------------------ */

export async function generateBudgetAdvice(
  provider: LlmProvider | undefined,
  brief: Brief,
  rows: readonly BudgetRow[],
): Promise<AiSectionResult<AiBudgetAdvice>> {
  const validKeys = new Set(rows.map((row) => row.key));
  const data = await callStructured({
    provider,
    messages: buildBudgetAdvicePrompt({ brief, rows }),
    schema: aiBudgetAdviceSchema,
    expectedShape:
      '{"headline":"...","tradeoffs":["..."],"suggestions":[{"from":"category-key","to":"category-key","percentOfTotal":5,"rationale":"..."}]}',
    maxTokens: TOKEN_BUDGET.budgetAdvice,
    promptId: PROMPT_IDS.budgetAdvice,
    temperature: 0.4,
  });

  if (data) {
    // Drop suggestions the model invented that do not exist in this ledger,
    // and never let a suggestion touch contingency.
    const suggestions = data.suggestions.filter(
      (suggestion) =>
        validKeys.has(suggestion.from) &&
        validKeys.has(suggestion.to) &&
        suggestion.from !== 'contingency',
    );
    return {
      data: { ...data, suggestions },
      source: 'ai',
      promptId: PROMPT_IDS.budgetAdvice,
    };
  }

  return {
    data: fallbackBudgetAdvice(brief, rows),
    source: 'fallback',
    promptId: PROMPT_IDS.budgetAdvice,
  };
}

/** Exported for the streaming chat route and for tests. */
export const aiInternals = { stripCodeFences };
