/**
 * Error taxonomy for the whole server side.
 *
 * Every failure the user can cause maps to a documented HTTP status and a
 * stable machine code; the message is always safe to show (no upstream detail,
 * no stack traces). Route handlers translate these into the shared
 * `{ error: { code, message, requestId } }` envelope.
 */
export type ApiErrorCode =
  | 'bad_request'
  | 'payload_too_large'
  | 'rate_limited'
  | 'origin_rejected'
  | 'ai_unavailable'
  | 'ai_failed'
  | 'not_found'
  | 'internal';

const STATUS_BY_CODE: Readonly<Record<ApiErrorCode, number>> = {
  bad_request: 400,
  payload_too_large: 413,
  rate_limited: 429,
  origin_rejected: 403,
  ai_unavailable: 503,
  ai_failed: 502,
  not_found: 404,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Seconds until the client may retry (only meaningful for 429/503). */
  readonly retryAfterSeconds?: number;

  constructor(code: ApiErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const badRequest = (message: string): AppError => new AppError('bad_request', message);
export const payloadTooLarge = (message: string): AppError =>
  new AppError('payload_too_large', message);
export const rateLimited = (retryAfterSeconds: number): AppError =>
  new AppError('rate_limited', 'Too many requests just now — give it a moment.', retryAfterSeconds);
export const originRejected = (): AppError =>
  new AppError('origin_rejected', 'This request did not come from the app.');
export const aiUnavailable = (): AppError =>
  new AppError('ai_unavailable', 'The AI planner is not configured on this deployment.');
/** 502 for a provider that answered badly; 504 when it ran out of time. */
export const aiFailed = (): AppError =>
  new AppError('ai_failed', 'The AI planner did not answer in time. A standard plan is shown.');
export const aiTimeout = (): AppError =>
  new AppError('ai_failed', 'The AI planner took too long. A standard plan is shown.');

/** Narrowing helper for catch blocks. */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
