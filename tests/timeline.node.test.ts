import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  formatMinutesOfDay,
  generateDayOf,
  generateMilestones,
  generateTimeline,
  isOverdue,
  toIsoDate,
} from '@/lib/domain/timeline';
import { TODAY_ISO, WEDDING_BRIEF } from '@/tests/fixtures';

describe('date helpers', () => {
  it('counts whole days in both directions', () => {
    expect(daysBetween('2026-10-20', '2026-10-20')).toBe(0);
    expect(daysBetween('2026-10-20', '2026-10-27')).toBe(7);
    expect(daysBetween('2026-10-20', '2026-10-19')).toBe(-1);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
  });

  it('formats minutes of day in 12-hour time', () => {
    expect(formatMinutesOfDay(0)).toBe('12:00 am');
    expect(formatMinutesOfDay(9 * 60 + 5)).toBe('9:05 am');
    expect(formatMinutesOfDay(12 * 60)).toBe('12:00 pm');
    expect(formatMinutesOfDay(23 * 60 + 30)).toBe('11:30 pm');
    expect(formatMinutesOfDay(24 * 60)).toBe('12:00 pm');
  });

  it('round-trips ISO dates', () => {
    expect(toIsoDate(new Date('2027-06-19T00:00:00Z'))).toBe('2027-06-19');
  });
});

describe('generateMilestones', () => {
  it('backward-plans from the event date', () => {
    const items = generateMilestones('wedding', '2028-06-19', TODAY_ISO);
    expect(items.length).toBeGreaterThan(10);
    const nameBudget = items.find((item) => item.id === 'm-north-star');
    expect(nameBudget?.dueDate).toBe('2027-06-19');
    expect(nameBudget?.compressed).toBe(false);
    const bookVenue = items.find((item) => item.id === 'm-venue-book');
    expect(bookVenue?.dueDate).toBe('2027-08-19');
    expect(items.every((item) => item.dueDate !== undefined)).toBe(true);
    expect(items.map((item) => item.order)).toEqual(items.map((_, index) => index));
  });

  it('compresses short lead times instead of producing past dates', () => {
    const items = generateMilestones('wedding', '2026-11-01', TODAY_ISO);
    const compressed = items.filter((item) => item.compressed);
    expect(compressed.length).toBeGreaterThan(0);
    expect(compressed.every((item) => item.dueDate === TODAY_ISO)).toBe(true);
    expect(items.every((item) => (item.dueDate ?? '') >= TODAY_ISO)).toBe(true);
  });

  it('keeps every milestone due for a past event (all overdue, none compressed)', () => {
    const items = generateMilestones('birthday', '2026-01-01', TODAY_ISO);
    expect(items.every((item) => item.compressed === false)).toBe(true);
    expect(items.every((item) => isOverdue(item.dueDate, TODAY_ISO))).toBe(true);
  });

  it('never emits items in the past for a same-day event', () => {
    const items = generateMilestones('community', TODAY_ISO, TODAY_ISO);
    expect(items.every((item) => (item.dueDate ?? '') >= TODAY_ISO)).toBe(true);
  });
});

describe('generateDayOf', () => {
  it('produces ordered, non-overlapping programme slots', () => {
    for (const type of ['wedding', 'birthday', 'community'] as const) {
      const slots = generateDayOf(type);
      expect(slots.length).toBeGreaterThan(5);
      for (const [index, slot] of slots.entries()) {
        expect(slot.startMin).toBeDefined();
        expect(slot.endMin).toBeDefined();
        expect(slot.endMin ?? 0).toBeGreaterThan(slot.startMin ?? 0);
        if (index > 0) {
          expect(slot.startMin ?? 0).toBeGreaterThanOrEqual(slots[index - 1]?.endMin ?? 0);
        }
        expect(slot.startMin ?? 0).toBeLessThan(24 * 60);
      }
    }
  });
});

describe('generateTimeline', () => {
  it('combines milestones and the day-of programme', () => {
    const items = generateTimeline(WEDDING_BRIEF.eventType, WEDDING_BRIEF.date, TODAY_ISO);
    expect(items.filter((item) => item.phase === 'milestone').length).toBeGreaterThan(10);
    expect(items.filter((item) => item.phase === 'dayof').length).toBeGreaterThan(5);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });
});
