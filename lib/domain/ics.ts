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
const FOLD_AT = 74;

/** Escapes a text value per RFC 5545 §3.3.11. */
export function escapeICalText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds a logical line into 74-character physical lines (CRLF + space). */
export function foldLine(line: string): string {
  if (line.length <= FOLD_AT) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, FOLD_AT));
  rest = rest.slice(FOLD_AT);
  while (rest.length > FOLD_AT - 1) {
    parts.push(` ${rest.slice(0, FOLD_AT - 1)}`);
    rest = rest.slice(FOLD_AT - 1);
  }
  if (rest.length > 0) parts.push(` ${rest}`);
  return parts.join(CRLF);
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
