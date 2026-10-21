/**
 * Named test fixtures shared across the suite.
 * Keeping them here (rather than inline) means a schema change breaks the
 * fixtures loudly instead of silently weakening every test.
 */
import type { Brief } from '@/lib/schemas/brief';

/** A complete, valid wedding brief. */
export const WEDDING_BRIEF: Brief = {
  eventType: 'wedding',
  date: '2027-06-19',
  location: 'Lisbon, Portugal',
  guestCount: 90,
  budgetMinor: 2_400_000,
  currency: 'EUR',
  theme: 'Candlelit garden dinner',
  considerations: 'Six vegetarian guests, one vegan.',
  mustHaves: ['Live band'],
  avoid: ['No sparklers indoors'],
  priorities: ['food', 'photos'],
};

/** A community brief used to check a second event type. */
export const COMMUNITY_BRIEF: Brief = {
  eventType: 'community',
  date: '2027-01-23',
  location: 'Riverside Park, Oakland',
  guestCount: 320,
  budgetMinor: 1_850_000,
  currency: 'USD',
  theme: 'Neighbourhood river festival',
  considerations: 'English and Spanish signage.',
  mustHaves: ['Free entry', 'Quiet hour'],
  avoid: ['No single-use plastic bottles'],
  priorities: ['value'],
};

/** Fixed "today" so date-dependent engine tests never flake. */
export const TODAY_ISO = '2026-10-20';
