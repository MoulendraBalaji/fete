/**
 * GET /api/health — deploy smoke test.
 *
 * Deliberately minimal. An earlier version reported the active prompt ids and
 * the rate-limit budget, which was useful for debugging and needless for a
 * public endpoint: prompt ids enumerate the internal surface, and a rate-limit
 * figure tells a prober exactly how much traffic to send. Neither is a secret,
 * but publication has a cost and no benefit here.
 *
 * What remains answers the one question worth asking of a deployment — "is the
 * AI configured?" — and nothing else. It never returns the key, the model name
 * or the base URL.
 */
import { NextResponse } from 'next/server';
import { serverEnv } from '@/lib/security/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const env = serverEnv();
  return NextResponse.json(
    {
      status: 'ok',
      ai: { configured: env.aiEnabled },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
