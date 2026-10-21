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

const envSchema = z.object({
  LLM_BASE_URL: z.string().url().max(300).optional(),
  LLM_API_KEY: z.string().min(8).max(500).optional(),
  LLM_MODEL: z.string().min(1).max(120).optional(),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(600).default(15),
});

export type ServerEnv = z.infer<typeof envSchema> & { aiEnabled: boolean; missing: string[] };

const REQUIRED_LLM_KEYS = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const;

/**
 * The four variables this app reads. Declared as a partial record rather than
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
  });

  if (!parsed.success) {
    // Fail fast, but never echo the value of a variable that may hold a secret.
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid server environment configuration (${fields}). Check your .env file.`);
  }

  const missing = REQUIRED_LLM_KEYS.filter((key) => !parsed.data[key]);
  return { ...parsed.data, aiEnabled: missing.length === 0, missing };
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
