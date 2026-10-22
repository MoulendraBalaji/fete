/**
 * POST /api/ideas
 * Body: { brief } → { ideas, source }
 *
 * Thin by design: identity/origin checks, validation and rate limiting come
 * from lib/api/handler, the work happens in lib/ai/service.
 */
import { NextResponse } from 'next/server';
import {
  aiResponseHeaders,
  assertSameOrigin,
  limitRequest,
  providerOrUndefined,
  readValidatedBody,
  withErrorHandling,
} from '@/lib/api/handler';
import { generateIdeas } from '@/lib/ai/service';
import { ideasRequestSchema } from '@/lib/schemas/api';

export const runtime = 'nodejs';
// Must be a literal: Next reads segment config statically at build time.
export const maxDuration = 30;

export const POST = withErrorHandling(async (request, requestId) => {
  assertSameOrigin(request);
  const remaining = await limitRequest(request, 'ideas');
  const { data } = await readValidatedBody(request, ideasRequestSchema, requestId);

  const result = await generateIdeas(providerOrUndefined(), data.brief, [], 6);

  return NextResponse.json(
    { ideas: result.data.ideas, source: result.source, promptId: result.promptId },
    { headers: aiResponseHeaders(remaining, requestId) },
  );
});
