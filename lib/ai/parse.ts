/**
 * Structured-output parsing.
 *
 * Models are asked for JSON only, but they still fence it, prefix it with
 * prose, or trail a comma. The ladder here is deliberately boring:
 *   1. parse as-is;
 *   2. strip code fences / surrounding prose and parse;
 *   3. ask the model once to repair its own output;
 *   4. give up and let the caller serve a deterministic fallback.
 *
 * This module is pure (the repair step is injected) so every rung is unit
 * testable without a network.
 */
import type { z } from 'zod';

export type ParseOutcome<T> =
  | { ok: true; value: T; repaired: boolean }
  | { ok: false; reason: 'empty' | 'unparseable' | 'schema' };

/** Removes ```json fences and any leading/trailing prose around a JSON value. */
export function stripCodeFences(raw: string): string {
  let text = raw.trim();

  const fenceMatch = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) text = fenceMatch[1].trim();

  // Isolate the outermost JSON object/array if the model added commentary.
  const firstBrace = findFirstJsonStart(text);
  if (firstBrace > 0) text = text.slice(firstBrace);

  const lastBrace = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (lastBrace >= 0 && lastBrace < text.length - 1) text = text.slice(0, lastBrace + 1);

  return text.trim();
}

/** Index of the first `{` or `[`, whichever comes first; -1 when neither. */
function findFirstJsonStart(text: string): number {
  const objectStart = text.indexOf('{');
  const arrayStart = text.indexOf('[');
  if (objectStart === -1) return arrayStart;
  if (arrayStart === -1) return objectStart;
  return Math.min(objectStart, arrayStart);
}

/** JSON.parse with a couple of common model slips tolerated. */
export function lenientJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const withoutTrailingCommas = text.replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(withoutTrailingCommas);
    } catch {
      return undefined;
    }
  }
}

/**
 * Parses and validates a model response against a schema.
 * `repair` is called at most once with the invalid text; pass `undefined` to
 * skip the retry (used when the caller has no provider configured).
 */
export async function parseStructured<T>(
  raw: string,
  schema: z.ZodType<T>,
  repair?: (invalidText: string) => Promise<string>,
): Promise<ParseOutcome<T>> {
  if (!raw.trim()) return { ok: false, reason: 'empty' };

  const first = validate(stripCodeFences(raw), schema);
  if (first.ok) return { ok: true, value: first.value, repaired: false };

  if (!repair)
    return first.reason === 'schema'
      ? { ok: false, reason: 'schema' }
      : { ok: false, reason: 'unparseable' };

  let repairedText: string;
  try {
    repairedText = await repair(raw.slice(0, 4000));
  } catch {
    return { ok: false, reason: first.reason };
  }
  const second = validate(stripCodeFences(repairedText), schema);
  if (second.ok) return { ok: true, value: second.value, repaired: true };
  return { ok: false, reason: second.reason };
}

function validate<T>(
  text: string,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false; reason: 'unparseable' | 'schema' } {
  const parsed = lenientJsonParse(text);
  if (parsed === undefined) return { ok: false, reason: 'unparseable' };
  const result = schema.safeParse(parsed);
  if (!result.success) return { ok: false, reason: 'schema' };
  return { ok: true, value: result.data };
}

/** Instruction appended when asking the model to repair its own JSON. */
export const REPAIR_INSTRUCTION =
  'Your previous answer was not valid JSON for the required schema. ' +
  'Reply with the corrected JSON only — no commentary, no code fences, no trailing commas.';
