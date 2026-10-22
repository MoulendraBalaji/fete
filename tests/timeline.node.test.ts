import { describe, expect, it } from 'vitest';
import {
  compareTimelineItems,
  daysBetween,
  formatMinutesOfDay,
  generateDayOf,
  generateMilestones,
  generateTimeline,
  isOverdue,
  moveTimelineItem,
  toIsoDate,
} from '@/lib/domain/timeline';
import type { TimelineItem } from '@/lib/schemas/plan';
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

describe('moveTimelineItem', () => {
  /** Minimal valid timeline item, so the tests state only what matters. */
  const item = (
    id: string,
    overrides: Partial<TimelineItem> = {},
  ): TimelineItem => ({
    id,
    phase: 'milestone',
    title: `Task ${id}`,
    detail: '',
    dueDate: '2026-11-01',
    done: false,
    order: 0,
    compressed: false,
    ...overrides,
  });

  /** The order the Timeline would render these items in. */
  const visible = (items: readonly TimelineItem[]) =>
    [...items].sort(compareTimelineItems).map((entry) => entry.id);

  it('swaps two items that share a due date', () => {
    const items = [item('aaa111', { order: 0 }), item('bbb222', { order: 1 })];
    const moved = moveTimelineItem(items, 'bbb222', 'up');
    expect(visible(moved)).toEqual(['bbb222', 'aaa111']);
  });

  it('moves an item later, not just earlier', () => {
    const items = [item('aaa111', { order: 0 }), item('bbb222', { order: 1 })];
    const moved = moveTimelineItem(items, 'aaa111', 'down');
    expect(visible(moved)).toEqual(['bbb222', 'aaa111']);
  });

  it('actually reorders across different due dates', () => {
    // A plain `order` swap would be invisible here: the sort reads the date
    // first, so the item would snap straight back. This is the case that makes
    // the naive implementation look broken.
    const items = [
      item('aaa111', { dueDate: '2026-11-01', order: 0 }),
      item('bbb222', { dueDate: '2026-12-01', order: 1 }),
    ];
    const moved = moveTimelineItem(items, 'bbb222', 'up');
    expect(visible(moved)).toEqual(['bbb222', 'aaa111']);
    // And the reverse move restores the original order.
    expect(visible(moveTimelineItem(moved, 'bbb222', 'down'))).toEqual(['aaa111', 'bbb222']);
  });

  it('moves within the run sheet by clock time', () => {
    const items = [
      item('aaa111', { phase: 'dayof', dueDate: undefined, startMin: 540, order: 0 }),
      item('bbb222', { phase: 'dayof', dueDate: undefined, startMin: 600, order: 1 }),
    ];
    expect(visible(moveTimelineItem(items, 'bbb222', 'up'))).toEqual(['bbb222', 'aaa111']);
  });

  it('is a no-op at the ends of the list', () => {
    const items = [item('aaa111', { order: 0 }), item('bbb222', { order: 1 })];
    expect(visible(moveTimelineItem(items, 'aaa111', 'up'))).toEqual(['aaa111', 'bbb222']);
    expect(visible(moveTimelineItem(items, 'bbb222', 'down'))).toEqual(['aaa111', 'bbb222']);
  });

  it('ignores an unknown id rather than corrupting the list', () => {
    const items = [item('aaa111', { order: 0 }), item('bbb222', { order: 1 })];
    const moved = moveTimelineItem(items, 'not-here', 'up');
    expect(visible(moved)).toEqual(['aaa111', 'bbb222']);
  });

  it('leaves items outside the swapped pair untouched', () => {
    const items = [
      item('aaa111', { dueDate: '2026-11-01', order: 0 }),
      item('bbb222', { dueDate: '2026-12-01', order: 1 }),
      item('ccc333', { dueDate: '2027-01-01', order: 2 }),
    ];
    const moved = moveTimelineItem(items, 'ccc333', 'up');
    // The third item stays exactly as it was; the two that traded places did so
    // deliberately (they swapped dates), which is the point of the operation.
    expect(moved.find((entry) => entry.id === 'aaa111')).toEqual(items[0]);
    expect(moved).toHaveLength(3);
  });

  it('swaps the date, because a date outranks `order` in the sort', () => {
    const items = [
      item('aaa111', { dueDate: '2026-11-01', order: 0 }),
      item('bbb222', { dueDate: '2026-12-01', order: 1 }),
    ];
    const moved = moveTimelineItem(items, 'bbb222', 'up');
    const first = moved.find((entry) => entry.id === 'bbb222');
    const second = moved.find((entry) => entry.id === 'aaa111');
    expect(first?.dueDate).toBe('2026-11-01');
    expect(second?.dueDate).toBe('2026-12-01');
  });

  it('swaps the clock times of two run-sheet slots', () => {
    const items = [
      item('aaa111', { phase: 'dayof', dueDate: undefined, startMin: 540, endMin: 600, order: 0 }),
      item('bbb222', { phase: 'dayof', dueDate: undefined, startMin: 600, endMin: 660, order: 1 }),
    ];
    const moved = moveTimelineItem(items, 'bbb222', 'up');
    expect(moved.find((entry) => entry.id === 'bbb222')?.startMin).toBe(540);
    expect(moved.find((entry) => entry.id === 'aaa111')?.startMin).toBe(600);
  });

  it('will not move an item across the countdown / run-sheet boundary', () => {
    const items = [
      item('aaa111', { phase: 'milestone', dueDate: '2026-11-01', order: 0 }),
      item('bbb222', { phase: 'dayof', dueDate: undefined, startMin: 540, order: 1 }),
    ];
    // The two sections are rendered as separate lists, so a move between them
    // would have no visible meaning and must be refused.
    expect(visible(moveTimelineItem(items, 'bbb222', 'up'))).toEqual(['aaa111', 'bbb222']);
  });
});
