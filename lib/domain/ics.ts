/**
 * RFC 5545 iCalendar export, generated client-side (no server round trip).
 *
 * Everything that comes from user text is escaped (backslash, semicolon,
 * comma, newline) and length-capped before it reaches the file, so a plan
 * with `<script>` in a task title cannot smuggle content into a calendar app.
 * Line folding at 75 octets is applied because many parsers reject long lines.
 */
import type { Plan, TimelineItem } from '../schemas/plan';
import { formatMinutesOfDay } from './timeline';

const CRLF = '\r\n';
const MAX_FIELD_CHARS = 200;
/**
 * RFC 5545 §3.1 requires physical lines of at most 75 *octets*, excluding the
 * CRLF. Folding is therefore measured in UTF-8 bytes, not JavaScript string
 * length: an emoji or an accented name is 2-4 bytes per code point, so a
 * `.length` check would happily emit an 80-octet line.
 *
 * 73 leaves room for the single leading space a continuation line carries while
 * staying inside 75 octets in every case.
 */
const FOLD_AT_OCTETS = 73;

const encoder = new TextEncoder();

/** UTF-8 length of a string in octets. */
function octets(value: string): number {
  return encoder.encode(value).length;
}

/** Escapes a text value per RFC 5545 §3.3.11. */
export function escapeICalText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Folds a logical line into continuation lines at 75-octet boundaries.
 *
 * Splitting never lands inside a surrogate pair: a code point is appended only
 * when the whole of it fits, so a line ending in an emoji is folded before it
 * rather than through it.
 */
export function foldLine(line: string): string {
  if (octets(line) <= 75) return line;

  const parts: string[] = [];
  let current = '';
  let currentOctets = 0;

  for (const char of line) {
    const charOctets = octets(char);
    if (currentOctets + charOctets > FOLD_AT_OCTETS) {
      parts.push(current);
      // Continuation lines start with a single space, which counts toward
      // the 75-octet budget.
      current = ` ${char}`;
      currentOctets = 1 + charOctets;
    } else {
      current += char;
      currentOctets += charOctets;
    }
  }
  if (current.length > 0) parts.push(current);

  return parts.join(CRLF);
}

/** Asserts the invariant the folding above is meant to guarantee. */
export function maxLineOctets(document: string): number {
  return document
    .split(CRLF)
    .reduce((longest, line) => Math.max(longest, octets(line)), 0);
}

function property(name: string, value: string): string {
  return foldLine(`${name}:${escapeICalText(value).slice(0, MAX_FIELD_CHARS)}`);
}

function dateProperty(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

/** `YYYY-MM-DD` → `YYYYMMDD`. */
function compactDate(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

/** Minutes after midnight → `THHMMSS` on a given date. */
function compactDateTime(isoDate: string, minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, minutes));
  const hour = String(Math.floor(clamped / 60)).padStart(2, '0');
  const minute = String(clamped % 60).padStart(2, '0');
  return `${compactDate(isoDate)}T${hour}${minute}00`;
}

function milestoneEvent(plan: Plan, item: TimelineItem, stamp: string): string[] {
  const lines = [
    'BEGIN:VEVENT',
    property('UID', `${item.id}-${plan.id}@fete.app`),
    dateProperty('DTSTAMP', stamp),
    dateProperty('DTSTART;VALUE=DATE', compactDate(item.dueDate ?? plan.brief.date)),
    property('SUMMARY', item.title),
    property(
      'DESCRIPTION',
      item.detail ? `${item.detail}${item.done ? ' [done]' : ''}` : item.done ? '[done]' : '',
    ),
    property('CATEGORIES', `FETE,${plan.brief.eventType.toUpperCase()}`),
    'END:VEVENT',
  ];
  return lines;
}

function dayOfEvent(plan: Plan, item: TimelineItem, stamp: string): string[] {
  const date = plan.brief.date;
  const start = item.startMin ?? 0;
  const end = item.endMin ?? start + 60;
  return [
    'BEGIN:VEVENT',
    property('UID', `${item.id}-${plan.id}@fete.app`),
    dateProperty('DTSTAMP', stamp),
    dateProperty('DTSTART', compactDateTime(date, start)),
    dateProperty('DTEND', compactDateTime(date, end)),
    property('SUMMARY', item.title),
    property(
      'DESCRIPTION',
      `${item.detail} (${formatMinutesOfDay(start)}–${formatMinutesOfDay(end)})`,
    ),
    property('CATEGORIES', `FETE,${plan.brief.eventType.toUpperCase()}`),
    'END:VEVENT',
  ];
}

/**
 * Builds a complete `.ics` document for a plan.
 * `stamp` is injected (UTC `YYYYMMDDTHHMMSSZ`) for deterministic tests.
 */
export function buildIcs(plan: Plan, stamp: string): string {
  const events = [...plan.timeline.items]
    .sort((a, b) => a.order - b.order)
    .flatMap((item) =>
      item.phase === 'milestone'
        ? milestoneEvent(plan, item, stamp)
        : dayOfEvent(plan, item, stamp),
    );

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fete//Event planning//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    property('X-WR-CALNAME', plan.name),
    ...events,
    'END:VCALENDAR',
  ];
  return lines.join(CRLF) + CRLF;
}
