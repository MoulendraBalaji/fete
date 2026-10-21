/**
 * POST /api/chat — streamed planning assistant.
 *
 * Returns `text/plain` in a `ReadableStream`: the client appends deltas as they
 * arrive. When no provider is configured (or the model fails mid-stream) the
 * handler degrades to a deterministic, still-useful answer streamed word by
 * word, and prefixes it with a machine-readable marker the UI turns into the
 * "standard answer" notice. This route is optional by design — the plan is
 * already complete without it.
 */
import {
  assertSameOrigin,
  limitRequest,
  providerOrUndefined,
  readValidatedBody,
  withErrorHandling,
} from '@/lib/api/handler';
import { buildChatPrompt } from '@/lib/ai/prompts';
import { fallbackChatAnswer } from '@/lib/ai/chatFallback';
import { aiFailed } from '@/lib/errors';
import { chatRequestSchema } from '@/lib/schemas/api';

export const runtime = 'nodejs';
// Must be a literal: Next reads segment config statically at build time.
export const maxDuration = 30;

const STREAM_DELIMITER = '\u0000';
const STANDARD_MARKER = `${STREAM_DELIMITER}standard${STREAM_DELIMITER}`;

export const POST = withErrorHandling(async (request, requestId) => {
  assertSameOrigin(request);
  limitRequest(request, 'chat');
  const { data } = await readValidatedBody(request, chatRequestSchema, requestId);
  const provider = providerOrUndefined();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      try {
        if (!provider) throw aiFailed();
        const messages = buildChatPrompt({ message: data.message, context: data.context });
        for await (const delta of provider.stream(messages, {
          maxTokens: 700,
          temperature: 0.5,
        })) {
          send(delta);
        }
      } catch {
        // Prefix tells the client this is a deterministic answer.
        send(STANDARD_MARKER);
        for (const chunk of fallbackChatAnswer(data.message, data.context)) {
          send(chunk);
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-request-id': requestId,
      'x-content-type-options': 'nosniff',
    },
  });
});
