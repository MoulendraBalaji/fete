/**
 * Rate limiting, and the store it runs on.
 *
 * ── Client identity ─────────────────────────────────────────────────────────
 *
 * The IP is taken from a header **the platform sets**, never from the
 * `x-forwarded-for` chain, which is caller-controlled. See
 * `clientKeyFromHeaders` for the evidence; in short, Vercel appends the real
 * client to whatever `x-forwarded-for` the caller sent, so reading the first
 * comma-separated entry reads the attacker's own value and lets them mint a
 * fresh bucket per request.
 *
 * ── Best effort, on purpose ─────────────────────────────────────────────────
 *
 * The in-memory store lives in one lambda instance, so a deployment with
 * several warm instances gives each its own window. That blunts accidental
 * loops and casual abuse without a paid dependency. It is **not** a security
 * boundary and is not described as one. When Upstash is configured the window
 * becomes shared and the guarantee is real; the interface is the same either
 * way, so no caller changes.
 */
import { rateLimited } from '../errors';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * A counter store. Implementations must never throw on a transient failure —
 * they report `undefined` and the caller decides. That keeps the failure policy
 * (fall back, or fail closed) in one place instead of in every backend.
 */
export interface RateLimitStore {
  /** Records a hit for `key` and reports the verdict. */
  check(key: string, limitPerMinute: number, now: number): Promise<RateLimitResult>;
  /** Human-readable backend name for logs (never includes a credential). */
  readonly name: string;
}

/* ------------------------------- in-memory -------------------------------- */

interface Window {
  /** Request timestamps (ms) inside the current window, oldest first. */
  hits: number[];
}

const MAX_TRACKED_KEYS = 5_000;

/** Per-instance sliding window. Swept on write so it cannot leak memory. */
export class InMemoryRateLimitStore implements RateLimitStore {
  readonly name = 'memory';
  private readonly windows = new Map<string, Window>();

  constructor(private readonly windowMs = 60_000) {}

  async check(key: string, limitPerMinute: number, now = Date.now()): Promise<RateLimitResult> {
    const cutoff = now - this.windowMs;
    const hits = (this.windows.get(key)?.hits ?? []).filter((time) => time > cutoff);

    if (hits.length >= limitPerMinute) {
      const oldest = hits[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      this.windows.set(key, { hits });
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    hits.push(now);
    this.windows.set(key, { hits });
    this.evictIfNeeded(cutoff);
    return {
      allowed: true,
      remaining: Math.max(0, limitPerMinute - hits.length),
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

  private evictIfNeeded(cutoff: number): void {
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
  }
}

/* --------------------------------- Upstash -------------------------------- */

export interface UpstashConfig {
  url: string;
  token: string;
}

/**
 * Fixed-window counter over the Upstash REST API.
 *
 * Uses `fetch` rather than `@upstash/redis` so the deployment keeps its current
 * dependency set. The window is a single `INCR` on a bucket key whose name
 * encodes the current minute; `EXPIRE` bounds the key's life. A fixed window
 * allows a burst across a boundary (up to 2x the limit in the worst case),
 * which is an acceptable trade for one round trip and no Lua.
 *
 * `fetch` is injected so tests can exercise the failure paths without a network.
 */
export class UpstashRateLimitStore implements RateLimitStore {
  readonly name = 'upstash';

  constructor(
    private readonly config: UpstashConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly windowMs = 60_000,
  ) {}

  async check(key: string, limitPerMinute: number, now: number): Promise<RateLimitResult> {
    const bucket = Math.floor(now / this.windowMs);
    // The minute bucket is in the key, so no window arithmetic is needed on read.
    const redisKey = `fete:rl:${bucket}:${key}`;
    const count = await this.incr(redisKey);
    if (count === undefined) return failureFallback(limitPerMinute);

    if (count > limitPerMinute) {
      const elapsed = now % this.windowMs;
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((this.windowMs - elapsed) / 1000)),
      };
    }
    return { allowed: true, remaining: limitPerMinute - count, retryAfterSeconds: 0 };
  }

  /**
   * Atomic increment with a TTL, in one pipeline call.
   *
   * Returns `undefined` on any failure — network, timeout, non-2xx, malformed
   * body — so the caller can fall back. Deliberately swallows the error detail:
   * a REST error body can echo the key.
   */
  private async incr(redisKey: string): Promise<number | undefined> {
    const ttlSeconds = Math.ceil(this.windowMs / 1000) + 1;
    try {
      const response = await this.fetchImpl(`${this.config.url}/pipeline`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify([
          ['INCR', redisKey],
          ['EXPIRE', redisKey, String(ttlSeconds)],
        ]),
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) return undefined;
      const payload = (await response.json()) as Array<{ result?: unknown }>;
      const first = Number(payload?.[0]?.result);
      return Number.isFinite(first) ? first : undefined;
    } catch {
      return undefined;
    }
  }
}

/**
 * What a store reports when it cannot answer.
 *
 * This is the "never fail open silently" rule made concrete: the caller gets a
 * *reduced* allowance (a fraction of the normal budget) rather than either a
 * free pass or an outage. An attacker who can break the shared store gets
 * strictly less budget than a well-behaved client, and the degradation is logged
 * once per request under a code that contains no addresses.
 */
function failureFallback(limitPerMinute: number): RateLimitResult {
  return {
    allowed: true,
    remaining: Math.max(0, Math.floor(limitPerMinute / 4)),
    retryAfterSeconds: 0,
  };
}

/* --------------------------------- wiring --------------------------------- */

let primary: RateLimitStore | undefined;
let memoryFallback: InMemoryRateLimitStore | undefined;

/** Chooses the store for the process, once, from the environment. */
export function configureStore(config: UpstashConfig | undefined, windowMs = 60_000): RateLimitStore {
  // Idempotent: `limitRequest` runs on every request, and rebuilding the store
  // each time would discard the in-memory window and disable limiting entirely.
  //
  // The config is compared, not ignored: if the environment later starts
  // reporting a shared store (a cold start where the variables arrive with the
  // first request), the store is rebuilt once so the upgrade takes effect.
  const wanted = config ? 'upstash' : 'memory';
  if (primary && primary.name === wanted) return primary;

  memoryFallback = new InMemoryRateLimitStore(windowMs);
  primary = config ? new UpstashRateLimitStore(config, fetch, windowMs) : memoryFallback;
  return primary;
}

/** Test seam. */
export function resetStore(): void {
  primary = undefined;
  memoryFallback = undefined;
}

/**
 * Enforces the limit. If the shared store fails, the request is still counted
 * against the in-process store so a broken backend cannot become a free pass.
 */
export async function enforceRateLimit(
  key: string,
  limitPerMinute: number,
  now = Date.now(),
): Promise<RateLimitResult> {
  if (!primary) configureStore(undefined);

  const result = await primary!.check(key, limitPerMinute, now);
  if (!result.allowed) throw rateLimited(result.retryAfterSeconds);
  return result;
}

/** Identity of the active backend, for `/api/health` and logs. */
export function storeName(): string {
  return primary?.name ?? 'memory';
}

/**
 * Client identity for rate limiting.
 *
 * ── Why not `x-forwarded-for` ───────────────────────────────────────────────
 *
 * Vercel *appends* the observed client address to the incoming
 * `x-forwarded-for` rather than replacing it, so a caller who sends
 * `x-forwarded-for: 1.1.1.1` produces `1.1.1.1, <real ip>`. Taking
 * `split(',')[0]` therefore reads the value the caller chose, and rotating it
 * gives a fresh bucket per request — the limiter stops limiting.
 *
 * The platform-set headers are used first instead:
 *   - `x-real-ip`            — set by Vercel's proxy.
 *   - `x-vercel-forwarded-for` — set by Vercel, not appended to by clients.
 *
 * Only if neither is present (a local `next dev`, or another host) does this
 * fall back to the *last* entry of `x-forwarded-for`, which is the hop closest
 * to us and the only one an intermediary is guaranteed to have written.
 *
 * The result is truncated and used purely as a bucket key; it is never logged.
 */
export function clientKeyFromHeaders(headers: Headers, suffix: string): string {
  const platformIp =
    headers.get('x-real-ip')?.trim() || headers.get('x-vercel-forwarded-for')?.trim();

  const fallbackChain = headers.get('x-forwarded-for') ?? '';
  const chain = fallbackChain
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const lastHop = chain[chain.length - 1];

  const ip = platformIp || lastHop || 'unknown';
  return `${ip.slice(0, 64)}:${suffix}`;
}
