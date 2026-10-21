/**
 * Per-IP sliding-window rate limiting.
 *
 * BEST EFFORT BY DESIGN: this lives in instance memory, so a Vercel deployment
 * with several warm lambdas gives each instance its own window. That is enough
 * to blunt accidental loops and casual abuse on a free tier without adding a
 * paid datastore; it is not a security boundary. A durable limiter (Upstash,
 * Vercel KV) is the upgrade path and would slot in behind this same interface.
 *
 * The store is swept on write so a long-lived instance cannot leak memory.
 */
import { rateLimited } from '../errors';

interface Window {
  /** Request timestamps (ms) inside the current window, oldest first. */
  hits: number[];
}

const MAX_TRACKED_KEYS = 5_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class SlidingWindowLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limitPerMinute: number,
    private readonly windowMs = 60_000,
  ) {}

  /** Records a hit and reports whether it is allowed. */
  check(key: string, now = Date.now()): RateLimitResult {
    const cutoff = now - this.windowMs;
    const hits = (this.windows.get(key)?.hits ?? []).filter((time) => time > cutoff);

    if (hits.length >= this.limitPerMinute) {
      const oldest = hits[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      this.windows.set(key, { hits });
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    hits.push(now);
    this.windows.set(key, { hits });
    this.evictIfNeeded(cutoff, now);
    return {
      allowed: true,
      remaining: Math.max(0, this.limitPerMinute - hits.length),
      retryAfterSeconds: 0,
    };
  }

  /** Number of tracked clients (test/observability helper). */
  get size(): number {
    return this.windows.size;
  }

  clear(): void {
    this.windows.clear();
  }

  /** Drops empty windows, then the oldest keys if the map is still oversized. */
  private evictIfNeeded(cutoff: number, now: number): void {
    for (const [key, window] of this.windows) {
      const live = window.hits.filter((time) => time > cutoff);
      if (live.length === 0) this.windows.delete(key);
      else window.hits = live;
    }

    while (this.windows.size > MAX_TRACKED_KEYS) {
      const oldest = this.windows.keys().next();
      if (oldest.done) break;
      this.windows.delete(oldest.value);
    }
    void now;
  }
}

let limiter: SlidingWindowLimiter | undefined;

/** Shared limiter for AI routes, sized from RATE_LIMIT_PER_MIN. */
export function getLimiter(limitPerMinute: number): SlidingWindowLimiter {
  limiter ??= new SlidingWindowLimiter(limitPerMinute);
  return limiter;
}

/** Test seam. */
export function resetLimiter(): void {
  limiter = undefined;
}

/** Throws a 429 `AppError` when the caller is over budget. */
export function enforceRateLimit(
  key: string,
  limitPerMinute: number,
  now = Date.now(),
): RateLimitResult {
  const result = getLimiter(limitPerMinute).check(key, now);
  if (!result.allowed) throw rateLimited(result.retryAfterSeconds);
  return result;
}

/**
 * Client identity for rate limiting.
 * Vercel sets `x-forwarded-for` (comma-separated, first entry is the client).
 * We hash-free-truncate that value: it is used as a bucket key only and is
 * never logged, satisfying the "no PII in logs" rule.
 */
export function clientKeyFromHeaders(headers: Headers, suffix: string): string {
  const forwarded = headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';
  return `${ip.slice(0, 64)}:${suffix}`;
}
