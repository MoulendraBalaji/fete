/**
 * POST /api/vendor-tips
 * Body: { brief, categoryKey } → { questions, redFlags, source }
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
import { generateVendorTips } from '@/lib/ai/service';
import { vendorTipsRequestSchema } from '@/lib/schemas/api';

export const runtime = 'nodejs';
// Must be a literal: Next reads segment config statically at build time.
export const maxDuration = 30;

export const POST = withErrorHandling(async (request, requestId) => {
  assertSameOrigin(request);
  const remaining = await limitRequest(request, 'vendor-tips');
  const { data } = await readValidatedBody(request, vendorTipsRequestSchema, requestId);

  const result = await generateVendorTips(providerOrUndefined(), data.brief, data.categoryKey);

  return NextResponse.json(
    {
      questions: result.data.questions,
      redFlags: result.data.redFlags,
      source: result.source,
      promptId: result.promptId,
    },
    { headers: aiResponseHeaders(remaining, requestId) },
  );
});
