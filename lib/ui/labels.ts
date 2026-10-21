/**
 * Display strings for the shared enums.
 *
 * Kept in one module so a label ("Booked", "High") is written once and reused
 * across the roster, ledger and timeline. Centralising also makes the
 * area-of-concern explicit: these are *presentation* strings, not domain logic —
 * changing one here can never alter a calculation.
 */
import type {
  AiSection,
  CostTier,
  EventType,
  IdeaKind,
  Priority,
  VendorStatus,
} from '@/lib/schemas/core';
import type { StampTone } from '@/components/ui/Stamp';

export const EVENT_TYPE_LABELS: Readonly<Record<EventType, string>> = {
  wedding: 'Wedding',
  birthday: 'Birthday',
  community: 'Community event',
};

export const EVENT_TYPE_BLURBS: Readonly<Record<EventType, string>> = {
  wedding: 'Ceremony, reception, and everything the two of you have to remember.',
  birthday: 'A milestone party that still has a budget and a run sheet.',
  community: 'A public gathering with permits, volunteers and a wellness plan.',
};

export const PRIORITY_LABELS: Readonly<Record<Priority, string>> = {
  food: 'Food & drink',
  music: 'Music & entertainment',
  photos: 'Photography',
  decor: 'Decor & flowers',
  attire: 'Attire & beauty',
  'guest-experience': 'Guest experience',
  value: 'Value for money',
};

export const PRIORITY_HINTS: Readonly<Record<Priority, string>> = {
  food: 'More of the budget goes to catering and the bar.',
  music: 'Bands, DJs and sound get a bigger envelope.',
  photos: 'Photography and film are protected.',
  decor: 'Flowers, styling and lighting are weighted up.',
  attire: 'Dress, hair and make-up keep a larger share.',
  'guest-experience': 'Transport, favours and comforts come first.',
  value: 'The planner favours cheaper options across the board.',
};

export const VENDOR_STATUS_LABELS: Readonly<Record<VendorStatus, string>> = {
  todo: 'To do',
  contacted: 'Contacted',
  quoted: 'Quoted',
  booked: 'Booked',
  paid: 'Paid',
};

export const VENDOR_STATUS_TONES: Readonly<Record<VendorStatus, StampTone>> = {
  todo: 'neutral',
  contacted: 'info',
  quoted: 'gold',
  booked: 'green',
  paid: 'accent',
};

export const COST_TIER_LABELS: Readonly<Record<CostTier, string>> = {
  free: 'No cost',
  low: 'Low cost',
  mid: 'Mid cost',
  high: 'High cost',
};

export const COST_TIER_TONES: Readonly<Record<CostTier, StampTone>> = {
  free: 'green',
  low: 'info',
  mid: 'gold',
  high: 'warn',
};

export const IDEA_KIND_LABELS: Readonly<Record<IdeaKind, string>> = {
  theme: 'Theme',
  menu: 'Menu',
  activity: 'Activity',
  decor: 'Decor',
  favor: 'Favour',
  volunteer: 'Volunteer',
  outreach: 'Outreach',
  other: 'Idea',
};

export const AI_SECTION_LABELS: Readonly<Record<AiSection, string>> = {
  ideas: 'Ideas',
  vendorTips: 'Vendor questions',
  budgetAdvice: 'Budget advice',
};

/** Order in which vendor statuses advance as the user moves work forward. */
export const VENDOR_STATUS_ORDER: readonly VendorStatus[] = [
  'todo',
  'contacted',
  'quoted',
  'booked',
  'paid',
];
