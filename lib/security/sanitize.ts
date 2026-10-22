/**
 * Input hygiene helpers.
 *
 * The app renders all AI text as plain text (never as HTML), so these helpers
 * exist to keep *prompts* structurally safe and to bound everything that leaves
 * the process — not to sanitise HTML.
 */
import { TEXT_LIMITS } from '../schemas/core';

/** Delimiter tokens used to fence untrusted user data inside a prompt. */
const OPEN_FENCE = '<<<';
const CLOSE_FENCE = '>>>';
const LABEL_OPEN = '[[';
const LABEL_CLOSE = ']]';

/**
 * Matches any fence/label token, optionally with the leftovers of a rewrite.
 *
 * The optional whitespace between repetitions is deliberate: `<< <<` and
 * `< < <` read as the fence to a model scanning for a delimiter even though a
 * literal match misses them, so runs of the same bracket with intervening
 * space or tab are collapsed as well.
 */
const FENCE_PATTERN = /<<<|>>>|\[\[|\]\]|\[\]{1,2}\]?|\[{1,2}\]|<{3,}|>{3,}|<\s*<\s*<|>\s*>\s*>|\[\s*\[|\]\s*\]/g;

/**
 * Characters that only appear in text as a deliberate obfuscation of a bracket
 * or angle bracket (fullwidth forms and a few common mathematical lookalikes).
 * Normalising them to their ASCII equivalents first means a fence written with
 * `＜＜＜` is caught by the same pattern as `<<<`.
 */
const LOOKALIKE_MAP: Readonly<Record<string, string>> = {
  '\uFF1C': '<', // fullwidth less-than
  '\uFF1E': '>', // fullwidth greater-than
  '\uFF3B': '[', // fullwidth left bracket
  '\uFF3D': ']', // fullwidth right bracket
  '\u2039': '<', // single left angle quote
  '\u203A': '>', // single right angle quote
  '\u3008': '<', // CJK left angle
  '\u3009': '>', // CJK right angle
  '\u27E8': '<', // mathematical left angle
  '\u27E9': '>', // mathematical right angle
};

/** Folds bracket lookalikes to ASCII so one pattern covers every spelling. */
export function normaliseBrackets(value: string): string {
  return value.replace(
    /[\uFF1C\uFF1E\uFF3B\uFF3D\u2039\u203A\u3008\u3009\u27E8\u27E9]/g,
    (char) => LOOKALIKE_MAP[char] ?? char,
  );
}

/**
 * Wraps untrusted user text in explicit delimiters so the model can tell data
 * from instructions. Delimiter-looking sequences inside the value are removed
 * so a user cannot close the block early.
 *
 * Pair with the system-prompt rule that everything inside the fence is data to
 * be described, never instructions to be followed.
 */
export function wrapUserData(label: string, value: string): string {
  const safeLabel = label.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 40);
  return `${LABEL_OPEN}${safeLabel}${LABEL_CLOSE}\n${OPEN_FENCE}\n${neuterDelimiters(value)}\n${CLOSE_FENCE}`;
}

/**
 * Removes fence tokens, control characters and runaway blank lines.
 *
 * Control characters are replaced with a *space*, not deleted: a form feed or
 * vertical tab conventionally separates tokens, so deleting it would weld two
 * words together (`"b\fc"` would become `"bc"`) and could silently change the
 * meaning of user data. Horizontal runs are then collapsed, and vertical
 * whitespace is capped at three newlines so a wall of blank lines cannot pad a
 * prompt out of its token budget.
 */
export function neuterDelimiters(value: string): string {
  return stripFences(normaliseBrackets(value))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .slice(0, TEXT_LIMITS.long * 2);
}

/**
 * Collapses leftover bracket noise so text never reads as a broken tag.
 *
 * Applied to the bracket-normalised form of the value, so a fence spelled with
 * fullwidth characters is neutralised exactly like its ASCII equivalent.
 */
export function stripFences(value: string): string {
  return normaliseBrackets(value)
    .replace(FENCE_PATTERN, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Truncates to a hard character budget without cutting a word in half. */
export function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const slice = value.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}

/** Collapses whitespace for single-line fields (badges, labels, ICS titles). */
export function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Cleans model output before it is stored, so no fence scaffolding can survive
 * into the plan (and therefore into a later prompt). Output is still
 * schema-validated and rendered as plain text.
 */
export function sanitizeModelText(value: string): string {
  return stripFences(value)
    .replace(/\s{2,}/g, ' ')
    .trim();
}
