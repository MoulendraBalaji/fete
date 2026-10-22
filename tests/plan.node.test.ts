import { describe, expect, it } from 'vitest';
import { buildDemoPlan, demoBriefFor } from '@/lib/domain/seeds';
import { createPlan, defaultPlanName, duplicatePlan, rebuildPlan } from '@/lib/domain/plan';
import { computeLedger } from '@/lib/domain/budget';
import { planSchema } from '@/lib/schemas/plan';
import { buildIcs, escapeICalText, foldLine, maxLineOctets } from '@/lib/domain/ics';
import { summarizePlan } from '@/lib/domain/summary';
import { TEXT_LIMITS } from '@/lib/schemas/core';
import { daysBetween } from '@/lib/domain/timeline';
import { TODAY_ISO, WEDDING_BRIEF } from '@/tests/fixtures';

const EVENT_TYPES = ['wedding', 'birthday', 'community'] as const;

/**
 * Reverses RFC 5545 line folding, restoring the logical lines a calendar parser
 * sees. Needed because a physical line may end mid-token, so raw substring
 * counts over a folded document are unreliable.
 */
function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, '');
}

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
    // RFC 5545 §3.1: 75 *octets*, not 75 characters.
    expect(maxLineOctets(ics)).toBeLessThanOrEqual(75);
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

  it('escapes a backslash before anything else it escapes', () => {
    // Order matters: escaping `;` first would turn `\;` into `\\;` and change
    // the meaning. A literal backslash must become `\\` and nothing more.
    expect(escapeICalText('a\\b')).toBe('a\\\\b');
    expect(escapeICalText('a;b')).toBe('a\\;b');
    expect(escapeICalText('a,b')).toBe('a\\,b');
    expect(escapeICalText('a\nb')).toBe('a\\nb');
    expect(escapeICalText('a\r\nb')).toBe('a\\nb');
    expect(escapeICalText('back\\slash;and,more')).toBe('back\\\\slash\\;and\\,more');
  });

  it('folds long lines at octet boundaries, never inside a code point', () => {
    // Each emoji is 4 UTF-8 octets, so a 75-*character* limit would emit a
    // line far past 75 octets. Folding must respect the byte budget.
    const emoji = '🎉'.repeat(40);
    const folded = foldLine(`SUMMARY:${emoji}`);
    expect(maxLineOctets(folded)).toBeLessThanOrEqual(75);
    // Folding must not split a surrogate pair, which would corrupt the text.
    const reassembled = folded
      .split('\r\n')
      .map((line, index) => (index === 0 ? line : line.slice(1)))
      .join('');
    expect(reassembled).toBe(`SUMMARY:${emoji}`);
    expect(reassembled).not.toContain('\uFFFD');
  });

  it('keeps a hostile accented and emoji name inside the octet limit', () => {
    const plan = buildDemoPlan('community', { todayIso: TODAY_ISO, now: 1, id: 'demo-ics-3' });
    const hostile = {
      ...plan,
      name: 'Fête — café ☕ 🎉🎉🎉 with a very long name that must still fold safely',
      vendors: plan.vendors.map((vendor, index) =>
        index === 0 ? { ...vendor, name: 'Zażółć gęślą jaźń 🎊\u0000<script>' } : vendor,
      ),
      timeline: {
        items: plan.timeline.items.map((item, index) =>
          index === 0
            ? { ...item, title: `${'🙂'.repeat(30)};,\\\nEND:VEVENT\nBEGIN:VEVENT` }
            : item,
        ),
      },
    };
    const ics = buildIcs(hostile, '20261020T000000Z');

    expect(maxLineOctets(ics)).toBeLessThanOrEqual(75);

    // A forged `END:VEVENT` inside a title must be escaped, not honoured, so
    // the event count still matches the plan.
    //
    // The assertion runs on the *unfolded* document: a folded physical line can
    // end mid-token (that is what folding means), so counting occurrences in the
    // raw text would report a false positive for a `BEGIN:VEVENT` that happens to
    // start a continuation line. Unfolding first restores the logical lines a
    // parser would see, which is the only form the count is meaningful in.
    const unfolded = unfold(ics);
    expect(unfolded.match(/^BEGIN:VEVENT$/gm)).toHaveLength(plan.timeline.items.length);
    expect(unfolded.match(/^END:VEVENT$/gm)).toHaveLength(plan.timeline.items.length);
    // And the forged token survived only as escaped data, never as a line.
    expect(ics).toContain('\\nBEGIN:VEVENT');
  });

  it('truncates an absurdly long field rather than emitting it whole', () => {
    const plan = buildDemoPlan('wedding', { todayIso: TODAY_ISO, now: 1, id: 'demo-ics-4' });
    const hostile = {
      ...plan,
      name: 'x'.repeat(5_000),
    };
    const ics = buildIcs(hostile, '20261020T000000Z');
    expect(maxLineOctets(ics)).toBeLessThanOrEqual(75);
    expect(ics).not.toContain('x'.repeat(300));
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
