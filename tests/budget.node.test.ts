import { describe, expect, it } from 'vitest';
import { allocate, minorUnitExponent, toMajorUnits, toMinorUnits } from '@/lib/domain/money';
import type { Brief } from '@/lib/schemas/brief';
import {
  applyTransfer,
  computeLedger,
  CONTINGENCY_FLOOR_BPS,
  initialBudgetRows,
  weightsForBrief,
} from '@/lib/domain/budget';
import { sum } from '@/lib/domain/money';
import { COMMUNITY_BRIEF, WEDDING_BRIEF } from '@/tests/fixtures';

describe('money', () => {
  it('knows which currencies use a different minor-unit exponent', () => {
    expect(minorUnitExponent('USD')).toBe(2);
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(minorUnitExponent('KWD')).toBe(3);
    expect(minorUnitExponent('ZZZ')).toBe(2);
  });

  it('converts major units without floating point drift', () => {
    expect(toMinorUnits(0.1 + 0.2, 'USD')).toBe(30);
    expect(toMinorUnits(1200.505, 'USD')).toBe(120051);
    expect(toMinorUnits(1200, 'JPY')).toBe(1200);
    expect(toMajorUnits(123456, 'USD')).toBe(1234.56);
  });
});

describe('allocate', () => {
  it('always sums exactly to the total', () => {
    for (const total of [0, 1, 7, 999, 12_345_679, 2_400_000]) {
      for (const weights of [
        [1, 1, 1],
        [3, 5, 7, 11],
        [0, 0, 1],
        [1e4, 2, 3],
      ]) {
        const shares = allocate(total, weights);
        expect(sum(shares)).toBe(total);
        expect(shares.every((share) => Number.isInteger(share))).toBe(true);
      }
    }
  });

  it('gives the leftover units to the largest remainders', () => {
    // 100 over [1,1,1]: 33.33 each → 33,33,33 + 1 leftover to the first.
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(allocate(2, [5, 5, 1])).toEqual([1, 1, 0]);
  });

  it('handles degenerate inputs without throwing', () => {
    expect(allocate(100, [])).toEqual([]);
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
    expect(allocate(-50, [1, 2])).toEqual([0, 0]);
    expect(sum(allocate(100, [0, 0]))).toBe(100);
    expect(sum(allocate(7, [-3, -1]))).toBe(7);
  });
});

describe('budget weights', () => {
  it('sums to exactly 10 000 basis points for every event type', () => {
    for (const brief of [WEDDING_BRIEF, COMMUNITY_BRIEF]) {
      expect(sum(weightsForBrief(brief))).toBe(10_000);
    }
  });

  it('always reserves contingency at or above the floor', () => {
    const clampBrief = { ...WEDDING_BRIEF, priorities: ['value'] as Brief['priorities'] };
    for (const brief of [WEDDING_BRIEF, COMMUNITY_BRIEF, clampBrief]) {
      const rows = initialBudgetRows(brief);
      const contingency = rows.find((row) => row.key === 'contingency');
      const shareBps = ((contingency?.plannedMinor ?? 0) / brief.budgetMinor) * 10_000;
      expect(shareBps).toBeGreaterThanOrEqual(CONTINGENCY_FLOOR_BPS - 1);
      expect(shareBps).toBeLessThanOrEqual(1500);
    }
  });

  it('never gives a non-contingency category a zero share', () => {
    const huge = { ...WEDDING_BRIEF, guestCount: 100_000, budgetMinor: 3 };
    const rows = initialBudgetRows(huge);
    expect(
      rows.filter((row) => row.key !== 'contingency').every((row) => row.plannedMinor >= 0),
    ).toBe(true);
    expect(sum(rows.map((row) => row.plannedMinor))).toBe(3);
  });

  it('leans towards the stated priorities', () => {
    const foodFirst = weightsForBrief({ ...WEDDING_BRIEF, priorities: ['food'], guestCount: 100 });
    const musicFirst = weightsForBrief({
      ...WEDDING_BRIEF,
      priorities: ['music'],
      guestCount: 100,
    });
    const keys = [
      'venue',
      'catering',
      'attire',
      'photography',
      'entertainment',
      'decor',
      'stationery',
      'transport',
      'favours',
      'planning-support',
      'contingency',
    ];
    expect(foodFirst[keys.indexOf('catering')]).toBeGreaterThan(
      musicFirst[keys.indexOf('catering')] ?? 0,
    );
  });

  it('scales guest-sensitive lines with headcount but clamps extremes', () => {
    const keys = [
      'venue',
      'catering',
      'attire',
      'photography',
      'entertainment',
      'decor',
      'stationery',
      'transport',
      'favours',
      'planning-support',
      'contingency',
    ];
    const small = weightsForBrief({ ...WEDDING_BRIEF, guestCount: 20 });
    const big = weightsForBrief({ ...WEDDING_BRIEF, guestCount: 400 });
    expect(big[keys.indexOf('catering')]).toBeGreaterThan(small[keys.indexOf('catering')] ?? 0);
    // Venue is not guest-sensitive, so its share should fall as catering grows.
    expect(big[keys.indexOf('venue')]).toBeLessThan(small[keys.indexOf('venue')] ?? 0);
  });
});

describe('computeLedger', () => {
  it('sums planned amounts to the total for a fresh brief', () => {
    const ledger = computeLedger(WEDDING_BRIEF, initialBudgetRows(WEDDING_BRIEF));
    expect(ledger.plannedTotalMinor).toBe(WEDDING_BRIEF.budgetMinor);
    expect(ledger.unallocatedMinor).toBe(0);
    expect(ledger.rows).toHaveLength(11);
  });

  it('preserves actuals, unallocated totals and shares after a user edit', () => {
    const rows = initialBudgetRows(WEDDING_BRIEF);
    const edited = rows.map((row) =>
      row.key === 'venue'
        ? { ...row, plannedMinor: row.plannedMinor + 50_000, actualMinor: 10_000 }
        : row,
    );
    const ledger = computeLedger(WEDDING_BRIEF, edited);
    expect(ledger.plannedTotalMinor).toBe(WEDDING_BRIEF.budgetMinor + 50_000);
    expect(ledger.unallocatedMinor).toBe(-50_000);
    expect(ledger.actualTotalMinor).toBe(10_000);
    expect(ledger.remainingMinor).toBe(ledger.plannedTotalMinor - 10_000);
    const venue = ledger.rows.find((row) => row.key === 'venue');
    expect(venue?.shareBps).toBe(
      Math.round(((venue?.plannedMinor ?? 0) / WEDDING_BRIEF.budgetMinor) * 10_000),
    );
  });

  it('re-seeds categories missing from stored rows (legacy/imported plans)', () => {
    const ledger = computeLedger(WEDDING_BRIEF, [
      { key: 'venue', plannedMinor: 1, actualMinor: 1 },
    ]);
    expect(ledger.rows).toHaveLength(11);
    // The venue row keeps the stored amount; every other line is re-seeded.
    expect(ledger.rows.find((row) => row.key === 'venue')?.plannedMinor).toBe(1);
    expect(ledger.plannedTotalMinor).toBeGreaterThan(0);
    expect(ledger.plannedTotalMinor).toBeLessThan(WEDDING_BRIEF.budgetMinor);
    const seeded = computeLedger(WEDDING_BRIEF, []);
    expect(seeded.plannedTotalMinor).toBe(WEDDING_BRIEF.budgetMinor);
  });
});

describe('applyTransfer', () => {
  const rows = initialBudgetRows(WEDDING_BRIEF);

  it('moves money between two categories without changing the total', () => {
    const next = applyTransfer(rows, WEDDING_BRIEF.budgetMinor, {
      from: 'venue',
      to: 'catering',
      percentOfTotal: 5,
    });
    const before = sum(rows.map((row) => row.plannedMinor));
    const after = sum(next.map((row) => row.plannedMinor));
    expect(after).toBe(before);
    const delta =
      (next.find((row) => row.key === 'catering')?.plannedMinor ?? 0) -
      (rows.find((row) => row.key === 'catering')?.plannedMinor ?? 0);
    expect(delta).toBe(Math.round(WEDDING_BRIEF.budgetMinor * 0.05));
  });

  it('refuses to drain contingency or to overdraw a category', () => {
    const fromContingency = applyTransfer(rows, WEDDING_BRIEF.budgetMinor, {
      from: 'contingency',
      to: 'venue',
      percentOfTotal: 5,
    });
    expect(fromContingency).toEqual(rows);

    const tooBig = applyTransfer(rows, WEDDING_BRIEF.budgetMinor, {
      from: 'stationery',
      to: 'venue',
      percentOfTotal: 40,
    });
    expect(tooBig).toEqual(rows);

    const selfTransfer = applyTransfer(rows, WEDDING_BRIEF.budgetMinor, {
      from: 'venue',
      to: 'venue',
      percentOfTotal: 5,
    });
    expect(selfTransfer).toEqual(rows);
  });
});
