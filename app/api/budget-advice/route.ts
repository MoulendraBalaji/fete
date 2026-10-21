/**
 * POST /api/budget-advice
 * Body: { brief, rows } → { headline, tradeoffs, suggestions, source }
 *
 * Suggestions are proposals only: the client shows each one with an "apply"
 * action, and nothing changes in the ledger until the user accepts it.
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
import { generateBudgetAdvice } from '@/lib/ai/service';
import { budgetAdviceRequestSchema } from '@/lib/schemas/api';

export const runtime = 'nodejs';
// Must be a literal: Next reads segment config statically at build time.
export const maxDuration = 30;

export const POST = withErrorHandling(async (request, requestId) => {
  assertSameOrigin(request);
  const remaining = limitRequest(request, 'budget-advice');
  const { data } = await readValidatedBody(request, budgetAdviceRequestSchema, requestId);

  const result = await generateBudgetAdvice(providerOrUndefined(), data.brief, data.rows);

  return NextResponse.json(
    {
      headline: result.data.headline,
      tradeoffs: result.data.tradeoffs,
      suggestions: result.data.suggestions,
      source: result.source,
      promptId: result.promptId,
    },
    { headers: aiResponseHeaders(remaining, requestId) },
  );
});
