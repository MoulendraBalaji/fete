/**
 * Server-only environment access, validated once at import time.
 *
 * `server-only` makes the build fail loudly if this module is ever imported
 * from a Client Component, which is the guarantee that keeps the API key out
 * of the browser bundle. The validated result is cached so a route handler
 * pays the parse cost once per instance.
 */
import 'server-only';
import { z } from 'zod';
import { DEFAULT_DAILY_CAP } from './dailyCap';

/**
 * The base URL must be HTTPS in production.
 *
 * The bearer token travels in a request header, so an `http:` base URL would
 * put the key on the wire in cleartext. `http://localhost` is still allowed
 * outside production so a local Ollama or a test gateway can be used, and
 * `NODE_ENV` is read at parse time rather than captured at module load so a
 * test can exercise both branches.
 */
const baseUrlSchema = z
  .string()
  .url()
  .max(300)
  .refine(
    (value) => {
      // `z.string().url()` has already guaranteed this parses; the guard is
      // defensive so a future schema change cannot make this throw, which
      // would escape as a raw TypeError instead of a validation failure.
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return false;
      }
      if (parsed.protocol === 'https:') return true;
      const isLoopback =
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '[::1]';
      return process.env.NODE_ENV !== 'production' && parsed.protocol === 'http:' && isLoopback;
    },
    'LLM_BASE_URL must use https (http is allowed only for loopback outside production)',
  );

const envSchema = z.object({
  LLM_BASE_URL: baseUrlSchema.optional(),
  LLM_API_KEY: z.string().min(8).max(500).optional(),
  LLM_MODEL: z.string().min(1).max(120).optional(),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(600).default(15),
  /** Ceiling on upstream calls per instance per UTC day. */
  LLM_DAILY_CALL_CAP: z.coerce.number().int().min(1).max(100_000).default(DEFAULT_DAILY_CAP),
  /** Optional shared rate-limit store; both must be set to activate it. */
  UPSTASH_REDIS_REST_URL: z.string().url().max(300).optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(8).max(500).optional(),
});

export type ServerEnv = z.infer<typeof envSchema> & {
  aiEnabled: boolean;
  missing: string[];
  upstashConfigured: boolean;
  upstash: { url: string; token: string } | undefined;
};

const REQUIRED_LLM_KEYS = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const;

/**
 * The variables this app reads. Declared as a partial record rather than
 * `NodeJS.ProcessEnv` because reading the environment must not require
 * `NODE_ENV` to exist — tests inject only the keys under test, and a
 * misconfigured deploy is exactly the case we want to describe precisely.
 */
export interface ServerEnvSource {
  readonly [key: string]: string | undefined;
}

/**
 * Reads and validates the server environment.
 * Missing LLM variables are *not* fatal: the app is designed to run fully
 * offline with deterministic fallbacks. They are reported by /api/health.
 */
export function loadServerEnv(source: ServerEnvSource = process.env): ServerEnv {
  const parsed = envSchema.safeParse({
    LLM_BASE_URL: emptyToUndefined(source.LLM_BASE_URL),
    LLM_API_KEY: emptyToUndefined(source.LLM_API_KEY),
    LLM_MODEL: emptyToUndefined(source.LLM_MODEL),
    RATE_LIMIT_PER_MIN: emptyToUndefined(source.RATE_LIMIT_PER_MIN) ?? '15',
    LLM_DAILY_CALL_CAP:
      emptyToUndefined(source.LLM_DAILY_CALL_CAP) ?? String(DEFAULT_DAILY_CAP),
    UPSTASH_REDIS_REST_URL: emptyToUndefined(source.UPSTASH_REDIS_REST_URL),
    UPSTASH_REDIS_REST_TOKEN: emptyToUndefined(source.UPSTASH_REDIS_REST_TOKEN),
  });

  if (!parsed.success) {
    // Fail fast, but never echo the value of a variable that may hold a secret.
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid server environment configuration (${fields}). Check your .env file.`);
  }

  const missing = REQUIRED_LLM_KEYS.filter((key) => !parsed.data[key]);
  const url = parsed.data.UPSTASH_REDIS_REST_URL;
  const token = parsed.data.UPSTASH_REDIS_REST_TOKEN;
  // Both halves are required; a URL without a token is treated as unconfigured
  // rather than as a half-open store that would fail on every request.
  const upstash = url && token ? { url, token } : undefined;

  return {
    ...parsed.data,
    aiEnabled: missing.length === 0,
    missing,
    upstashConfigured: Boolean(url && token),
    upstash,
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

let cached: ServerEnv | undefined;

/** Cached environment for request handlers. */
export function serverEnv(): ServerEnv {
  cached ??= loadServerEnv();
  return cached;
}

/** Test seam: clears the memoised environment. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
