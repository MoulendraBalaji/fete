/**
 * LLM provider abstraction.
 *
 * Everything above this file talks to `LlmProvider`, never to a vendor SDK, so
 * swapping Gemini/Groq/OpenRouter for a different vendor is a config change.
 * The concrete adapter below speaks the OpenAI-compatible
 * `/chat/completions` shape, which all three of those providers expose.
 *
 * Two guarantees this module enforces:
 *  - a hard AbortController timeout, so a stalled vendor cannot hold a
 *    serverless invocation open;
 *  - errors are surfaced as `AppError`s with no upstream body attached, so
 *    provider messages can never leak to the client or the logs.
 */
import 'server-only';
import { aiFailed, aiUnavailable } from '../errors';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  /** Hard ceiling on generated tokens — keeps latency and cost predictable. */
  maxTokens: number;
  /** 0 for extraction-style tasks; slightly higher for prose. */
  temperature?: number;
  /** Abort threshold in milliseconds (default 20 s, under the route budget). */
  timeoutMs?: number;
  /** Force JSON-only output where the provider supports it. */
  jsonMode?: boolean;
  /** Ask the provider not to buffer when streaming. */
  stream?: boolean;
  signal?: AbortSignal;
}

export interface LlmProvider {
  /** Provider name for /api/health (never includes the base URL or key). */
  readonly name: string;
  readonly model: string;
  /** Single completion, returned as text. */
  complete(messages: ChatMessage[], options: CompletionOptions): Promise<string>;
  /** Streamed completion; yields text deltas as they arrive. */
  stream(messages: ChatMessage[], options: CompletionOptions): AsyncIterable<string>;
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const JSON_MODE_HEADER = 'response_format';

/** Shared request body builder for both complete() and stream(). */
interface CompletionBody {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  temperature: number;
  stream: boolean;
  response_format?: { type: 'json_object' };
}

function buildBody(
  model: string,
  messages: ChatMessage[],
  options: CompletionOptions,
  stream: boolean,
): CompletionBody {
  const body: CompletionBody = {
    model,
    messages,
    max_tokens: Math.max(64, Math.min(options.maxTokens, 2048)),
    temperature: options.temperature ?? 0.6,
    stream,
  };
  if (options.jsonMode) body[JSON_MODE_HEADER] = { type: 'json_object' };
  return body;
}

/** Combines an external signal with the timeout signal. */
function withTimeout(timeoutMs: number, outer?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!outer) return timeout;
  return AbortSignal.any([timeout, outer]);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/** OpenAI-compatible chat-completions adapter. */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible';
  readonly model: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  /** Providers that reject `response_format` are remembered to avoid repeats. */
  private jsonModeUnsupported = false;

  constructor(config: ProviderConfig) {
    this.endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
      // Some gateways (OpenRouter) use these for attribution only.
      'http-referer': 'https://fete.app',
      'x-title': 'Fete event planner',
    };
  }

  async complete(messages: ChatMessage[], options: CompletionOptions): Promise<string> {
    const wantsJson = Boolean(options.jsonMode) && !this.jsonModeUnsupported;
    try {
      const response = await this.post(
        buildBody(this.model, messages, options, false),
        options,
        wantsJson,
      );
      const text = await response.text();
      return extractContent(text);
    } catch (error) {
      if (wantsJson && error instanceof UpstreamRejection) {
        // Retry once without response_format: some free tiers disable JSON mode.
        this.jsonModeUnsupported = true;
        const retry = await this.complete(messages, { ...options, jsonMode: false });
        return retry;
      }
      throw toAppError(error);
    }
  }

  async *stream(messages: ChatMessage[], options: CompletionOptions): AsyncIterable<string> {
    let response: Response;
    try {
      response = await this.post(buildBody(this.model, messages, options, true), options, false);
    } catch (error) {
      throw toAppError(error);
    }

    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const delta = parseStreamLine(line);
          if (delta) yield delta;
        }
      }
      const trailing = parseStreamLine(buffer);
      if (trailing) yield trailing;
    } catch (error) {
      throw toAppError(error);
    } finally {
      reader.releaseLock();
    }
  }

  private async post(
    body: CompletionBody,
    options: CompletionOptions,
    jsonMode: boolean,
  ): Promise<Response> {
    if (jsonMode) body.response_format = { type: 'json_object' };
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: withTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.signal),
    });
    if (!response.ok) throw new UpstreamRejection(response.status);
    return response;
  }
}

/** Internal marker so we can tell "provider said no" from a transport failure. */
class UpstreamRejection extends Error {
  constructor(readonly status: number) {
    super(`upstream ${status}`);
    this.name = 'UpstreamRejection';
  }
}

/** Maps any thrown value to a safe `AppError` (no upstream detail escapes). */
function toAppError(error: unknown): Error {
  if (isAbort(error)) return aiFailed();
  if (error instanceof UpstreamRejection) return aiFailed();
  return aiFailed();
}

/** Reads `choices[0].message.content` defensively. */
function extractContent(rawBody: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw aiFailed();
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) throw aiFailed();
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  if (typeof content === 'string') return content;
  // Some gateways return an array of parts.
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => (typeof part === 'string' ? part : ((part as { text?: string }).text ?? '')))
      .join('');
    return parts;
  }
  throw aiFailed();
}

/** Parses one SSE line from a streamed chat completion. */
function parseStreamLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return '';
  const data = trimmed.slice(5).trim();
  if (data === '' || data === '[DONE]') return '';
  try {
    const payload = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    return payload.choices?.[0]?.delta?.content ?? '';
  } catch {
    // A malformed frame is skipped rather than killing the stream.
    return '';
  }
}

/**
 * Builds the configured provider, or `undefined` when the deployment has no
 * LLM credentials — in which case every AI route serves deterministic
 * fallbacks and the app stays fully usable.
 */
export function createProvider(config: ProviderConfig | undefined): LlmProvider | undefined {
  if (!config) return undefined;
  try {
    return new OpenAiCompatibleProvider(config);
  } catch {
    throw aiUnavailable();
  }
}
