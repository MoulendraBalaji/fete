import { describe, expect, it } from 'vitest';
import { buildDemoPlan, demoBriefFor } from '@/lib/domain/seeds';
import { createPlan, defaultPlanName, duplicatePlan, rebuildPlan } from '@/lib/domain/plan';
import { computeLedger } from '@/lib/domain/budget';
import { planSchema } from '@/lib/schemas/plan';
import { buildIcs } from '@/lib/domain/ics';
import { summarizePlan } from '@/lib/domain/summary';
import { TEXT_LIMITS } from '@/lib/schemas/core';
import { daysBetween } from '@/lib/domain/timeline';
import { TODAY_ISO, WEDDING_BRIEF } from '@/tests/fixtures';

const EVENT_TYPES = ['wedding', 'birthday', 'community'] as const;

describe('createPlan', () => {
  it('produces a schema-valid plan whose ledger sums to the total', () => {
    const plan = createPlan(WEDDING_BRIEF, { todayIso: TODAY_ISO, now: 1, id: 'plan-one' });
    expect(planSchema.safeParse(plan).success).toBe(true);
    const ledger = computeLedger(plan.brief, plan.budget.rows);
    expect(ledger.rows.reduce((total, row) => total + row.plannedMinor, 0)).toBe(
      WEDDING_BRIEF.budgetMinor,
    );
  });

  it('names the plan from the brief', () => {
    expect(defaultPlanName(WEDDING_BRIEF)).toBe('Wedding · Lisbon, Portugal · 19 Jun 2027');
  });
});

describe('rebuildPlan', () => {
  it('keeps actuals when the brief changes', () => {
    const plan = createPlan(WEDDING_BRIEF, { todayIso: TODAY_ISO, now: 1, id: 'plan-two' });
    const withSpend = {
      ...plan,
      budget: {
        rows: plan.budget.rows.map((row) =>
          row.key === 'venue' ? { ...row, actualMinor: 1234 } : row,
        ),
      },
    };
    const rebuilt = rebuildPlan(withSpend, { ...WEDDING_BRIEF, guestCount: 140 }, TODAY_ISO);
    expect(rebuilt.budget.rows.find((row) => row.key === 'venue')?.actualMinor).toBe(1234);
    expect(rebuilt.brief.guestCount).toBe(140);
  });

  it('keeps milestone ticks on a date change and resets them on a type change', () => {
    const plan = createPlan(WEDDING_BRIEF, { todayIso: TODAY_ISO, now: 1, id: 'plan-three' });
    const ticked = {
      ...plan,
      timeline: {
        items: plan.timeline.items.map((item, index) =>
          index === 0 ? { ...item, done: true } : item,
        ),
      },
    };
    const sameType = rebuildPlan(ticked, { ...WEDDING_BRIEF, date: '2028-09-09' }, TODAY_ISO);
    expect(sameType.timeline.items[0]?.done).toBe(true);

    const otherType = rebuildPlan(sameType, { ...WEDDING_BRIEF, eventType: 'birthday' }, TODAY_ISO);
    expect(otherType.timeline.items[0]?.done).toBe(false);
    expect(otherType.ideas).toEqual([]);
    expect(otherType.vendors[0]?.label).toBe('Space');
  });
});

describe('duplicatePlan', () => {
  it('copies deeply with a new id and name', () => {
    const plan = createPlan(WEDDING_BRIEF, { todayIso: TODAY_ISO, now: 1, id: 'plan-four' });
    const copy = duplicatePlan(plan, { id: 'plan-five', now: 2 });
    expect(copy.id).toBe('plan-five');
    expect(copy.name.endsWith('(copy)')).toBe(true);
    copy.budget.rows[0]!.plannedMinor = 999;
    expect(plan.budget.rows[0]?.plannedMinor).not.toBe(999);
  });
});

describe('seed demo plans', () => {
  it.each(EVENT_TYPES)('builds a valid, coherent %s dossier', (eventType) => {
    const plan = buildDemoPlan(eventType, { todayIso: TODAY_ISO, now: 1, id: `demo-${eventType}` });
    const parsed = planSchema.safeParse(plan);
    expect(parsed.success).toBe(true);

    const ledger = computeLedger(plan.brief, plan.budget.rows);
    expect(ledger.plannedTotalMinor).toBe(plan.brief.budgetMinor);
    expect(ledger.actualTotalMinor).toBeGreaterThan(0);
    expect(ledger.contingencyMinor).toBeGreaterThan(0);

    expect(plan.ideas.length).toBeGreaterThan(0);
    expect(plan.ideas.some((idea) => idea.pinned)).toBe(true);
    expect(
      plan.vendors.some((vendor) => vendor.status === 'booked' || vendor.status === 'paid'),
    ).toBe(true);
    expect(plan.timeline.items.some((item) => item.done)).toBe(true);
    expect(daysBetween(TODAY_ISO, plan.brief.date)).toBeGreaterThan(0);
  });

  it('keeps a demo brief in the future for the landing page', () => {
    for (const eventType of EVENT_TYPES) {
      const brief = demoBriefFor(eventType, TODAY_ISO);
      expect(daysBetween(TODAY_ISO, brief.date)).toBeGreaterThan(0);
    }
  });
});

describe('ics export', () => {
  it('emits a well-formed calendar containing every item', () => {
    const plan = buildDemoPlan('wedding', { todayIso: TODAY_ISO, now: 1, id: 'demo-ics' });
    const ics = buildIcs(plan, '20261020T000000Z');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(plan.timeline.items.length);
    expect(ics).toContain('X-WR-CALNAME:');
    expect(ics.split('\r\n').every((line) => line.length <= 75)).toBe(true);
  });

  it('escapes injection-hostile text', () => {
    const plan = buildDemoPlan('birthday', { todayIso: TODAY_ISO, now: 1, id: 'demo-ics-2' });
    const hostile = {
      ...plan,
      timeline: {
        items: plan.timeline.items.map((item, index) =>
          index === 0 ? { ...item, title: 'Pay; DELETE,all\nX-EVIL:1' } : item,
        ),
      },
    };
    const ics = buildIcs(hostile, '20261020T000000Z');
    expect(ics).toContain('Pay\\; DELETE\\,all\\nX-EVIL:1');
    expect(ics.match(/\nX-EVIL/g)).toBeNull();
  });
});

describe('plan digest', () => {
  it('stays inside the chat context budget', () => {
    for (const eventType of EVENT_TYPES) {
      const plan = buildDemoPlan(eventType, { todayIso: TODAY_ISO, now: 1, id: `d-${eventType}` });
      const digest = summarizePlan(plan, TODAY_ISO);
      expect(digest.length).toBeLessThanOrEqual(TEXT_LIMITS.chatContext);
      expect(digest).toContain('Event:');
      expect(digest).toContain('Ledger');
    }
  });

  it('drops low-priority sections when the budget is tiny', () => {
    const plan = buildDemoPlan('wedding', { todayIso: TODAY_ISO, now: 1, id: 'demo-tiny' });
    const digest = summarizePlan(plan, TODAY_ISO, 120);
    expect(digest.length).toBeLessThanOrEqual(120);
    expect(digest).toContain('Event:');
  });
});
