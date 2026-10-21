/**
 * Money and weighting primitives.
 *
 * Why integer minor units: storing money as floats makes `$0.1 + $0.2` drift,
 * which surfaces as a ledger that is forever off by a cent. Every monetary value in
 * this app is an integer count of the currency's minor unit; floats appear only
 * at display time inside Intl.NumberFormat.
 *
 * Why largest-remainder: rounding each category independently means the parts
 * can sum to total ± n/2 units. The largest-remainder method (also called the
 * Hamilton method) floors every share, then hands the leftover units to the
 * biggest fractional remainders — so the parts always sum to exactly the total,
 * which is a hard requirement for the Ledger.
 *
 * Capacity note: allocation math multiplies total × weight (< 1e10 × 1e4),
 * far below Number.MAX_SAFE_INTEGER, so integer maths here is exact.
 */

/** Minor-unit exponents for currencies that don't use 2 decimal places. */
const MINOR_UNIT_EXPONENTS: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  TND: 3,
  JOD: 3,
};

const DEFAULT_MINOR_UNIT_EXPONENT = 2;

/** Decimal places in the currency's minor unit (USD → 2, JPY → 0, KWD → 3). */
export function minorUnitExponent(currency: string): number {
  return MINOR_UNIT_EXPONENTS[currency] ?? DEFAULT_MINOR_UNIT_EXPONENT;
}

/** Sum of integer values. */
export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Splits `totalMinor` across `weights` so the parts sum to exactly `totalMinor`.
 * Negative weights are clamped to zero; an all-zero split falls back to an
 * equal share (also exact).
 */
export function allocate(totalMinor: number, weights: readonly number[]): number[] {
  const total = Math.max(0, Math.trunc(totalMinor));
  const count = weights.length;
  if (count === 0) return [];

  const safeWeights = weights.map((weight) => Math.max(0, weight));
  const weightTotal = sum(safeWeights);

  if (weightTotal === 0) {
    const base = Math.floor(total / count);
    const shares = new Array<number>(count).fill(base);
    const leftover = total - base * count;
    for (let index = 0; index < leftover; index += 1) {
      shares[index] = (shares[index] ?? 0) + 1;
    }
    return shares;
  }

  const shares: number[] = [];
  const remainders: Array<{ index: number; remainder: number }> = [];
  let assigned = 0;

  for (const [index, weight] of safeWeights.entries()) {
    const exact = total * weight;
    const share = Math.floor(exact / weightTotal);
    shares.push(share);
    assigned += share;
    remainders.push({ index, remainder: exact % weightTotal });
  }

  // Biggest fractional share first; ties broken by position for determinism.
  remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  let leftover = total - assigned;
  for (const { index } of remainders) {
    if (leftover <= 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    leftover -= 1;
  }
  return shares;
}

/** Whole minor units for an amount typed in major units (e.g. 1200.50 → 120050). */
export function toMinorUnits(majorAmount: number, currency: string): number {
  const exponent = minorUnitExponent(currency);
  return Math.round(majorAmount * 10 ** exponent);
}

/** Major-unit value for an amount stored in minor units (display/input only). */
export function toMajorUnits(minorAmount: number, currency: string): number {
  const exponent = minorUnitExponent(currency);
  return minorAmount / 10 ** exponent;
}

/**
 * Formats money for display. Locale-aware via Intl; the integer minor amount
 * is converted only here, at the presentation boundary.
 */
export function formatMoney(minorAmount: number, currency: string, locale?: string): string {
  const exponent = minorUnitExponent(currency);
  const amount = minorAmount / 10 ** exponent;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(amount);
  } catch {
    // Unknown currency code from a hand-edited plan: fall back to plain digits.
    return `${amount.toFixed(exponent)} ${currency}`;
  }
}
