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

/** Matches any fence/label token, optionally with the leftovers of a rewrite. */
const FENCE_PATTERN = /<<<|>>>|\[\[|\]\]|\[\]{1,2}\]?|\[{1,2}\]/g;

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
  return `${LABEL_OPEN}${safeLabel}]]\n${OPEN_FENCE}\n${neuterDelimiters(value)}\n${CLOSE_FENCE}`;
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
  return stripFences(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .slice(0, TEXT_LIMITS.long * 2);
}

/** Collapses leftover bracket noise so text never reads as a broken tag. */
export function stripFences(value: string): string {
  return value
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
