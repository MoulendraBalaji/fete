/**
 * GET /api/health — configuration sanity without leaking secrets.
 *
 * Reports whether the LLM is configured, which provider shape is in use and
 * the rate-limit budget. It never returns the key, the model name or the base
 * URL, so it is safe to leave public (and useful for a deploy smoke test).
 */
import { NextResponse } from 'next/server';
import { serverEnv } from '@/lib/security/env';
import { PROMPT_IDS } from '@/lib/ai/prompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const env = serverEnv();
  return NextResponse.json(
    {
      status: 'ok',
      ai: {
        // Only presence is reported, never the value.
        configured: env.aiEnabled,
        provider: env.aiEnabled ? 'openai-compatible' : 'none',
        missingVariables: env.missing,
      },
      rateLimit: { perMinute: env.RATE_LIMIT_PER_MIN, scope: 'per-instance, best effort' },
      prompts: PROMPT_IDS,
      time: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
