/**
 * Shared plumbing for route handlers.
 *
 * Every AI route follows the same spine: same-origin check → body size cap →
 * zod validation → rate limit → service call → consistent error envelope.
 * Business logic never lives here.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { AppError, badRequest, isAppError, originRejected, payloadTooLarge } from '../errors';
import { clientKeyFromHeaders, enforceRateLimit } from '../security/rateLimit';
import { serverEnv } from '../security/env';
import type { ApiError } from '../schemas/api';
import type { LlmProvider } from '../ai/provider';
import { createProvider } from '../ai/provider';

/** Body cap for AI routes: a full plan digest plus a message is well under this. */
export const MAX_BODY_BYTES = 32_768;

/** Longest a route should run before Vercel cuts it off (chat streams). */
export const ROUTE_MAX_DURATION_SECONDS = 30;

/** Stable per-request id for correlating logs without logging any content. */
export function newRequestId(): string {
  return `req_${Math.random().toString(36).slice(2, 10)}`;
}

/** Builds the standard error envelope. */
export function errorResponse(error: unknown, requestId: string): NextResponse<ApiError> {
  const appError = isAppError(error) ? error : new AppError('internal', 'Something went wrong.');
  const headers: Record<string, string> = { 'x-request-id': requestId };
  if (appError.retryAfterSeconds) {
    headers['retry-after'] = String(appError.retryAfterSeconds);
  }
  return NextResponse.json(
    { error: { code: appError.code, message: appError.message, requestId } },
    { status: appError.status, headers },
  );
}

/**
 * Same-origin guard for state-changing requests.
 * Browsers always send `Origin` on POST; if it is present it must match the
 * host the request arrived on. A missing Origin (curl, server-to-server) is
 * rejected too, because this API is only ever called by our own client.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) throw originRejected();
  try {
    if (new URL(origin).host !== host) throw originRejected();
  } catch {
    throw originRejected();
  }
}

/** Rejects an oversized body before it is parsed. */
export function assertBodySize(request: Request): void {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw payloadTooLarge('That request was too large. Trim the plan and try again.');
  }
}

export interface ValidatedRequest<T> {
  data: T;
  requestId: string;
}

/**
 * Parses, size-checks and validates the JSON body.
 * `schema` must be `.strict()` so unknown keys are rejected (they are then
 * impossible to smuggle into a prompt).
 */
export async function readValidatedBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  requestId: string,
): Promise<ValidatedRequest<T>> {
  assertBodySize(request);

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    throw badRequest('The request body could not be read.');
  }
  if (raw.length > MAX_BODY_BYTES) {
    throw payloadTooLarge('That request was too large. Trim the plan and try again.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest('The request body was not valid JSON.');
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw badRequest(describeIssues(result.error.issues));
  }
  return { data: result.data, requestId };
}

/** Human-readable, non-leaking summary of validation failures. */
function describeIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const first = issues[0];
  if (!first) return 'That request did not validate.';
  const field = first.path.map(String).join('.') || 'body';
  return `Check the ${field} field: ${first.message}`;
}

/** Rate limits by client IP; returns the remaining budget for the response. */
export function limitRequest(request: Request, suffix: string): number {
  const env = serverEnv();
  const key = clientKeyFromHeaders(request.headers, suffix);
  return enforceRateLimit(key, env.RATE_LIMIT_PER_MIN).remaining;
}

/** Headers every AI response carries (cache guidance + no-store for privacy). */
export function aiResponseHeaders(remaining: number, requestId: string): Record<string, string> {
  return {
    'cache-control': 'no-store',
    'x-ratelimit-remaining': String(remaining),
    'x-request-id': requestId,
  };
}

/** The configured provider, or undefined when the deployment is offline. */
export function providerOrUndefined(): LlmProvider | undefined {
  const env = serverEnv();
  if (!env.aiEnabled) return undefined;
  return createProvider({
    baseUrl: env.LLM_BASE_URL as string,
    apiKey: env.LLM_API_KEY as string,
    model: env.LLM_MODEL as string,
  });
}

/**
 * Wraps a handler with the standard error mapping.
 * Logs only the error code, prompt id and request id — never user content.
 */
export function withErrorHandling(
  handler: (request: Request, requestId: string) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const requestId = newRequestId();
    try {
      return await handler(request, requestId);
    } catch (error) {
      const appError = isAppError(error) ? error : undefined;
      const line = JSON.stringify({
        requestId,
        code: appError?.code ?? 'internal',
        path: new URL(request.url).pathname,
      });
      // Client errors (a bad body, a rejected origin, a rate limit) are
      // expected traffic, so they are recorded as warnings. Only a genuine
      // fault — an unexpected throw or a provider failure — is an error, which
      // keeps an on-call review of `error` logs meaningful.
      if (appError && appError.status < 500) console.warn(line);
      else console.error(line);
      return errorResponse(error, requestId);
    }
  };
}
