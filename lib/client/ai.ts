'use client';

/**
 * Browser-side AI client.
 *
 * The key never reaches this code: every call goes to our own route handlers,
 * which hold the credential server-side. This module's job is to make those
 * calls pleasant — typed results, honest error mapping, and cancellation so a
 * fast-typing user does not pile up requests.
 *
 * Nothing here assumes the model exists. Every call can resolve to
 * `source: 'fallback'`, which the UI reports rather than hiding.
 */
import type { Brief } from '@/lib/schemas/brief';
import type { AiBudgetAdvice, AiIdea, AiVendorTips } from '@/lib/schemas/api';

export type AiSource = 'ai' | 'fallback';

/** The marker the chat route prefixes when it had to answer deterministically. */
const STANDARD_MARKER = '\u0000standard\u0000';

export interface AiFailure {
  ok: false;
  /** HTTP status when there was a response, or 0 for a network/abort failure. */
  status: number;
  code: string;
  message: string;
  retryAfterSeconds?: number;
}

export interface AiSuccess<T> {
  ok: true;
  data: T;
  source: AiSource;
}

export type AiResult<T> = AiSuccess<T> | AiFailure;

interface RequestOptions {
  signal?: AbortSignal;
}

/** Turns any thrown value into a user-safe failure; never surfaces upstream text. */
function failureFrom(error: unknown): AiFailure {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { ok: false, status: 0, code: 'aborted', message: 'Request cancelled.' };
  }
  return {
    ok: false,
    status: 0,
    code: 'network',
    message: 'Could not reach the planner service. Check your connection and try again.',
  };
}

/** Shared POST + envelope parsing for the three structured AI endpoints. */
async function postJson<T>(
  path: string,
  body: unknown,
  { signal }: RequestOptions = {},
): Promise<AiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    return failureFrom(error);
  }

  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after'));
    let code = 'internal';
    let message = 'Something went wrong on our side. Please try again.';
    try {
      const payload: unknown = await response.json();
      if (payload && typeof payload === 'object' && 'error' in payload) {
        const envelope = (payload as { error?: { code?: unknown; message?: unknown } }).error;
        if (typeof envelope?.code === 'string') code = envelope.code;
        if (typeof envelope?.message === 'string') message = envelope.message;
      }
    } catch {
      // Non-JSON error body: keep the generic message.
    }
    return {
      ok: false,
      status: response.status,
      code,
      message,
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    };
  }

  try {
    const payload = (await response.json()) as T & { source?: AiSource };
    return { ok: true, data: payload, source: payload.source ?? 'ai' };
  } catch {
    return {
      ok: false,
      status: response.status,
      code: 'malformed',
      message: 'The planner sent an unreadable response. Please try again.',
    };
  }
}

export function requestIdeas(
  brief: Brief,
  options?: RequestOptions,
): Promise<AiResult<{ ideas: AiIdea[] }>> {
  return postJson<{ ideas: AiIdea[] }>('/api/ideas', { brief }, options);
}

export function requestVendorTips(
  brief: Brief,
  categoryKey: string,
  options?: RequestOptions,
): Promise<AiResult<AiVendorTips>> {
  return postJson<AiVendorTips>('/api/vendor-tips', { brief, categoryKey }, options);
}

export function requestBudgetAdvice(
  brief: Brief,
  rows: unknown,
  options?: RequestOptions,
): Promise<AiResult<AiBudgetAdvice>> {
  return postJson<AiBudgetAdvice>('/api/budget-advice', { brief, rows }, options);
}

export interface ChatChunk {
  /** Text appended to the answer so far. */
  delta: string;
  /** True once the server signals a deterministic (non-model) answer. */
  standard: boolean;
}

/**
 * Streams a chat answer.
 *
 * The server frames a fallback answer with a NUL-delimited marker, so the client
 * strips any marker bytes out of the visible text and reports the answer as
 * "standard" once it has been seen.
 */
export async function* streamChat(
  message: string,
  context: string,
  { signal }: RequestOptions = {},
): AsyncGenerator<ChatChunk, void, undefined> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, context }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`chat_failed_${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let standard = false;
  let buffer = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Hold back a partial marker at the tail of the buffer.
      if (!standard && buffer.includes(STANDARD_MARKER)) {
        standard = true;
        buffer = buffer.replace(STANDARD_MARKER, '');
      }
      const held = standard ? 0 : partialMarkerLength(buffer);
      const flushable = held > 0 ? buffer.slice(0, buffer.length - held) : buffer;
      buffer = held > 0 ? buffer.slice(buffer.length - held) : '';
      if (flushable) yield { delta: flushable, standard };
    }
    if (buffer) yield { delta: buffer.replace(STANDARD_MARKER, ''), standard };
  } finally {
    reader.releaseLock();
  }
}

/** Length of a trailing string that could still be the start of the marker. */
function partialMarkerLength(buffer: string): number {
  const max = Math.min(STANDARD_MARKER.length - 1, buffer.length);
  for (let length = max; length > 0; length -= 1) {
    if (buffer.endsWith(STANDARD_MARKER.slice(0, length))) return length;
  }
  return 0;
}
