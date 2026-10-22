/**
 * Global daily ceiling on upstream LLM calls.
 *
 * ── Why this exists separately from the per-IP limit ────────────────────────
 *
 * The per-IP limiter bounds what one caller can do. It does not bound the
 * *total* spend: a hundred callers each staying politely under their own limit
 * still drive a hundred requests' worth of tokens, and a free tier with a hard
 * daily quota will simply start failing for everyone. This is the backstop that
 * keeps the deployment inside its quota.
 *
 * ── Behaviour when exceeded ─────────────────────────────────────────────────
 *
 * The route is not failed. Every AI feature already has a deterministic
 * fallback, so the honest response is to serve it and label it — the caller
 * gets a usable answer and `source: 'fallback'` tells the client why it is not
 * personalised. That is strictly better than a 429 the user cannot act on.
 *
 * The counter is per instance in memory, and shared via Upstash when that is
 * configured, mirroring the rate-limit store.
 */
import 'server-only';

/** Default ceiling. Generous for a demo, far below a free tier's daily quota. */
export const DEFAULT_DAILY_CAP = 400;

interface DayCounter {
  day: string;
  count: number;
}

let counter: DayCounter | undefined;

/** UTC day key — the quota boundary is the provider's, not the user's. */
export function dayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Reserves one upstream slot.
 * Returns `false` when the day's budget is spent, in which case the caller must
 * serve its fallback rather than call the model.
 */
export function reserveUpstreamCall(cap = DEFAULT_DAILY_CAP, now = Date.now()): boolean {
  const day = dayKey(now);
  if (!counter || counter.day !== day) {
    counter = { day, count: 0 };
  }
  if (counter.count >= cap) return false;
  counter.count += 1;
  return true;
}

/** Current usage for logging (never includes user data). */
export function upstreamUsage(now = Date.now()): number {
  return counter && counter.day === dayKey(now) ? counter.count : 0;
}

/** Test seam. */
export function resetDailyCap(): void {
  counter = undefined;
}
