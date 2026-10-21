/**
 * The Run of Show — deterministic backward-planning timeline.
 *
 * Milestones are generated from the event date by subtracting each template's
 * lead time. Short lead times are handled by *compression*, never by crashing:
 * any milestone whose natural date has already passed is rescheduled to today
 * and flagged `compressed`, so a three-week wedding still yields a usable plan.
 * A past event date simply marks everything overdue (the UI shows a notice).
 *
 * Pure — dates are passed in, `Date.now()` is never called here.
 */
import type { EventType } from '../schemas/core';
import type { TimelineItem } from '../schemas/plan';

const MS_PER_DAY = 86_400_000;

export type MilestoneCategory = 'money' | 'venue' | 'guests' | 'vendors' | 'details' | 'final';

export interface MilestoneTemplate {
  key: string;
  title: string;
  detail: string;
  /** How long before the event this normally happens. */
  lead: { months?: number; weeks?: number; days?: number };
  category: MilestoneCategory;
}

export interface DayOfTemplate {
  key: string;
  startMin: number;
  endMin: number;
  title: string;
  detail: string;
}

/* ------------------------------- date helpers ------------------------------ */

/** Parses `YYYY-MM-DD` as UTC midnight (timezone-independent date maths). */
export function parseIsoDate(dateIso: string): Date {
  return new Date(`${dateIso}T00:00:00Z`);
}

/** Formats a Date back to `YYYY-MM-DD`. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseIsoDate(toIso).getTime() - parseIsoDate(fromIso).getTime()) / MS_PER_DAY);
}

/** `eventIso` minus the template lead time, as `YYYY-MM-DD`. */
function shiftLead(eventIso: string, lead: MilestoneTemplate['lead']): string {
  const date = parseIsoDate(eventIso);
  if (lead.months) date.setUTCMonth(date.getUTCMonth() - lead.months);
  if (lead.weeks) date.setUTCDate(date.getUTCDate() - lead.weeks * 7);
  if (lead.days) date.setUTCDate(date.getUTCDate() - lead.days);
  return toIsoDate(date);
}

/** "2:30 pm" — used for day-of rows, ICS titles and printed programmes. */
export function formatMinutesOfDay(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const hour24 = Math.floor(clamped / 60);
  const minute = clamped % 60;
  const meridiem = hour24 >= 12 ? 'pm' : 'am';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${meridiem}`;
}

/* -------------------------------- templates -------------------------------- */

const WEDDING_MILESTONES: readonly MilestoneTemplate[] = [
  {
    key: 'north-star',
    category: 'money',
    lead: { months: 12 },
    title: 'Name the budget and the guest list',
    detail: 'One honest conversation: what you can spend, and roughly who is coming.',
  },
  {
    key: 'shortlist',
    category: 'venue',
    lead: { months: 11 },
    title: 'Shortlist three venues and hold a date',
    detail: 'Visit in the light you will actually marry in.',
  },
  {
    key: 'venue-book',
    category: 'venue',
    lead: { months: 10 },
    title: 'Sign the venue',
    detail: 'Ask about corkage, curfews, noise limits and a wet-weather plan.',
  },
  {
    key: 'caterer',
    category: 'vendors',
    lead: { months: 9 },
    title: 'Taste and book the caterer',
    detail: 'Put every dietary and cultural requirement from your brief on the tasting brief.',
  },
  {
    key: 'photo',
    category: 'vendors',
    lead: { months: 8 },
    title: 'Book photography and video',
    detail: 'The day flies past; these are the only people who keep it.',
  },
  {
    key: 'save-dates',
    category: 'guests',
    lead: { months: 7 },
    title: 'Send save-the-dates',
    detail: 'First to guests travelling far or needing time off.',
  },
  {
    key: 'attire',
    category: 'details',
    lead: { months: 6 },
    title: 'Start attire fittings',
    detail: 'Sketch first, fabric second, alterations booked third.',
  },
  {
    key: 'music',
    category: 'vendors',
    lead: { months: 6 },
    title: 'Book the band or DJ',
    detail: 'Hand over your must-play and hard-no lists in writing.',
  },
  {
    key: 'florals',
    category: 'details',
    lead: { months: 5 },
    title: 'Agree flowers and decor',
    detail: 'In-season flowers cost less, travel better and look fresher.',
  },
  {
    key: 'cake',
    category: 'details',
    lead: { months: 5 },
    title: 'Cake tasting and order',
    detail: 'Confirm dietary variants so the kitchen is never guessing.',
  },
  {
    key: 'invites',
    category: 'guests',
    lead: { months: 4 },
    title: 'Mail invitations',
    detail: 'Ask for replies six weeks ahead so numbers settle early.',
  },
  {
    key: 'stay',
    category: 'venue',
    lead: { months: 3 },
    title: 'Transport and hotel block',
    detail: 'Hold rooms before you confirm the shuttle route.',
  },
  {
    key: 'seating',
    category: 'guests',
    lead: { months: 2 },
    title: 'Draft the seating plan',
    detail: 'Keep one spare seat per table for good surprises.',
  },
  {
    key: 'favours',
    category: 'details',
    lead: { months: 2 },
    title: 'Order favours and gifts',
    detail: 'Anything personalised needs real lead time.',
  },
  {
    key: 'confirm',
    category: 'final',
    lead: { months: 1 },
    title: 'Confirm numbers with every vendor',
    detail: 'Final headcount, timings and one contact number each.',
  },
  {
    key: 'rehearsal',
    category: 'final',
    lead: { weeks: 1 },
    title: 'Rehearse and welcome your people',
    detail: 'Walk it once, then let the day run on its own.',
  },
  {
    key: 'handover',
    category: 'final',
    lead: { days: 3 },
    title: 'Pack, pay, hand over',
    detail: 'Tips in envelopes, vendor contacts, emergency kit, phone to a trusted person.',
  },
];

const BIRTHDAY_MILESTONES: readonly MilestoneTemplate[] = [
  {
    key: 'north-star',
    category: 'money',
    lead: { weeks: 8 },
    title: 'Set the budget and the theme',
    detail: 'A theme is a filter for every later decision — keep it to three words.',
  },
  {
    key: 'space',
    category: 'venue',
    lead: { weeks: 6 },
    title: 'Book the space',
    detail: 'Home, park or hire — either way, check noise rules and a wet-weather plan.',
  },
  {
    key: 'invites',
    category: 'guests',
    lead: { weeks: 5 },
    title: 'Send invitations',
    detail: 'Include the finish time; people plan their whole evening around it.',
  },
  {
    key: 'cake',
    category: 'details',
    lead: { weeks: 4 },
    title: 'Order the cake',
    detail: 'Confirm allergy info now, not on collection day.',
  },
  {
    key: 'entertainment',
    category: 'vendors',
    lead: { weeks: 4 },
    title: 'Lock in entertainment or activities',
    detail: 'Performer, playlist, games — book the popular ones first.',
  },
  {
    key: 'menu',
    category: 'vendors',
    lead: { weeks: 2 },
    title: 'Finalise the menu',
    detail: 'Check every guest note against what you are actually serving.',
  },
  {
    key: 'replies',
    category: 'guests',
    lead: { days: 10 },
    title: 'Chase replies and confirm numbers',
    detail: 'Numbers drive food, seating and the cake order.',
  },
  {
    key: 'decor',
    category: 'details',
    lead: { weeks: 1 },
    title: 'Order and pre-assemble decor',
    detail: 'Pre-cut ribbon and pre-inflate nothing — assemble the night before.',
  },
  {
    key: 'helpers',
    category: 'final',
    lead: { days: 4 },
    title: 'Assign helpers and a run sheet',
    detail: 'One person owns the door, one owns the food, one owns the music.',
  },
  {
    key: 'prep',
    category: 'final',
    lead: { days: 1 },
    title: 'Shop, chill and lay it all out',
    detail: 'Everything within arm’s reach before the first guest arrives.',
  },
];

const COMMUNITY_MILESTONES: readonly MilestoneTemplate[] = [
  {
    key: 'north-star',
    category: 'money',
    lead: { months: 4 },
    title: 'Set the date, the committee and the budget',
    detail: 'Write down who decides what — it saves weeks later.',
  },
  {
    key: 'permits',
    category: 'venue',
    lead: { months: 3, weeks: 2 },
    title: 'Apply for permits and insurance',
    detail: 'Council timelines are the longest pole; start here.',
  },
  {
    key: 'space',
    category: 'venue',
    lead: { months: 3 },
    title: 'Confirm the site, power and access',
    detail: 'Power, step-free routes, toilets and shade before anything pretty.',
  },
  {
    key: 'sponsors',
    category: 'money',
    lead: { months: 2, weeks: 2 },
    title: 'Ask local sponsors to close the gap',
    detail: 'Offer tiers in writing; never promise crowds you cannot prove.',
  },
  {
    key: 'program',
    category: 'guests',
    lead: { months: 2 },
    title: 'Build the program and invite speakers',
    detail: 'Confirm dietary, language and access needs with every speaker.',
  },
  {
    key: 'volunteers',
    category: 'final',
    lead: { weeks: 8 },
    title: 'Recruit and rota volunteers',
    detail: 'Nobody volunteers for a vague role — name the job and the hours.',
  },
  {
    key: 'outreach',
    category: 'guests',
    lead: { weeks: 6 },
    title: 'Launch outreach in every language you need',
    detail: 'Flyers where people already stand, not only online.',
  },
  {
    key: 'vendors',
    category: 'vendors',
    lead: { months: 1 },
    title: 'Book rentals, AV and first aid',
    detail: 'Get certificates of insurance before you pay a deposit.',
  },
  {
    key: 'run-sheet',
    category: 'final',
    lead: { weeks: 2 },
    title: 'Publish the run of show',
    detail: 'One page: times, owners, phone numbers, escalation contact.',
  },
  {
    key: 'supplies',
    category: 'details',
    lead: { days: 3 },
    title: 'Buy supplies and print signage',
    detail: 'Signs for entrances, toilets, water and the quiet corner.',
  },
  {
    key: 'setup',
    category: 'final',
    lead: { days: 1 },
    title: 'Brief the setup crew',
    detail: 'Walk the site together before anyone lifts a table.',
  },
];

const WEDDING_DAY_OF: readonly DayOfTemplate[] = [
  {
    key: 'hair',
    startMin: 8 * 60,
    endMin: 10 * 60 + 30,
    title: 'Hair and makeup begins',
    detail: 'Artists on site by 7:45 — breakfast arrives with them.',
  },
  {
    key: 'deliveries',
    startMin: 10 * 60 + 30,
    endMin: 11 * 60 + 15,
    title: 'Flowers and decor delivered',
    detail: 'Name the person who meets every supplier at the door.',
  },
  {
    key: 'details',
    startMin: 11 * 60 + 15,
    endMin: 12 * 60,
    title: 'Photographer: details and getting-ready shots',
    detail: 'Rings, invitation suite and the dress hung in good light.',
  },
  {
    key: 'lunch',
    startMin: 12 * 60,
    endMin: 13 * 60 + 15,
    title: 'Wedding-party lunch',
    detail: 'Light and simple — nobody wants a heavy plate in photographs.',
  },
  {
    key: 'arrival',
    startMin: 13 * 60 + 30,
    endMin: 14 * 60,
    title: 'Guests arrive and are seated',
    detail: 'Ushers in place, orders of service in hand.',
  },
  {
    key: 'ceremony',
    startMin: 14 * 60,
    endMin: 14 * 60 + 45,
    title: 'Ceremony',
    detail: 'Music starts five minutes before guests are seated.',
  },
  {
    key: 'confetti',
    startMin: 14 * 60 + 45,
    endMin: 15 * 60 + 30,
    title: 'Confetti line and family photos',
    detail: 'Announce the confetti moment before it happens — it always fizzles otherwise.',
  },
  {
    key: 'drinks',
    startMin: 15 * 60 + 30,
    endMin: 16 * 60 + 45,
    title: 'Drinks reception',
    detail: 'Keep it shaded and close to where dinner will happen.',
  },
  {
    key: 'turnaround',
    startMin: 17 * 60,
    endMin: 17 * 60 + 30,
    title: 'Room turns around; guests find seats',
    detail: 'The band plays through the turnaround.',
  },
  {
    key: 'dinner',
    startMin: 17 * 60 + 30,
    endMin: 19 * 60,
    title: 'Dinner service',
    detail: 'Final headcount is already with the caterer.',
  },
  {
    key: 'speeches',
    startMin: 19 * 60,
    endMin: 19 * 60 + 30,
    title: 'Speeches',
    detail: 'Three speakers maximum, four minutes each.',
  },
  {
    key: 'party',
    startMin: 19 * 60 + 30,
    endMin: 23 * 60,
    title: 'First dance and party',
    detail: 'Straight from cake into the first dance — no dead air.',
  },
  {
    key: 'sendoff',
    startMin: 23 * 60,
    endMin: 23 * 60 + 30,
    title: 'Last drinks and send-off',
    detail: 'Delegate the card box and gift collection before this point.',
  },
];

const BIRTHDAY_DAY_OF: readonly DayOfTemplate[] = [
  {
    key: 'setup',
    startMin: 15 * 60 + 30,
    endMin: 16 * 60 + 30,
    title: 'Setup crew arrives',
    detail: 'Music on while you work — setup goes twice as fast.',
  },
  {
    key: 'food',
    startMin: 16 * 60 + 30,
    endMin: 17 * 60,
    title: 'Food and drink laid out',
    detail: 'Drinks tub first, so arrivals have something in hand.',
  },
  {
    key: 'arrivals',
    startMin: 17 * 60,
    endMin: 17 * 60 + 15,
    title: 'Guests arrive',
    detail: 'Name tags if two circles are meeting for the first time.',
  },
  {
    key: 'games',
    startMin: 17 * 60 + 15,
    endMin: 18 * 60,
    title: 'Games and activity block',
    detail: 'One loud game, one quiet one — nobody sits out.',
  },
  {
    key: 'meal',
    startMin: 18 * 60,
    endMin: 18 * 60 + 45,
    title: 'Meal served',
    detail: 'Serve dietary plates first and by name.',
  },
  {
    key: 'cake',
    startMin: 18 * 60 + 45,
    endMin: 19 * 60,
    title: 'Cake moment',
    detail: 'Candles lit, camera ready, lights low.',
  },
  {
    key: 'toast',
    startMin: 19 * 60,
    endMin: 19 * 60 + 30,
    title: 'Speech or toast',
    detail: 'Mic passed, volume checked, one loud voice only.',
  },
  {
    key: 'dance',
    startMin: 19 * 60 + 30,
    endMin: 21 * 60,
    title: 'Music and free play',
    detail: 'Playlist has a defined end — the evening needs a last song.',
  },
  {
    key: 'favours',
    startMin: 21 * 60,
    endMin: 21 * 60 + 30,
    title: 'Farewell and favours',
    detail: 'Hand-outs at the door, not abandoned on tables.',
  },
];

const COMMUNITY_DAY_OF: readonly DayOfTemplate[] = [
  {
    key: 'setup',
    startMin: 7 * 60 + 30,
    endMin: 8 * 60 + 30,
    title: 'Setup crew on site',
    detail: 'Volunteer shirts out; radio or group-channel check.',
  },
  {
    key: 'safety',
    startMin: 8 * 60 + 30,
    endMin: 9 * 60,
    title: 'Safety and access walk',
    detail: 'Step-free route, exits, first-aid point and water marked.',
  },
  {
    key: 'briefing',
    startMin: 9 * 60,
    endMin: 9 * 60 + 30,
    title: 'Volunteer briefing',
    detail: 'Roles, break rota, and who to escalate to.',
  },
  {
    key: 'doors',
    startMin: 9 * 60 + 30,
    endMin: 10 * 60,
    title: 'Welcome desk opens',
    detail: 'Registration list and walk-up policy agreed at the desk.',
  },
  {
    key: 'opening',
    startMin: 10 * 60,
    endMin: 10 * 60 + 30,
    title: 'Opening remarks',
    detail: 'Thank sponsors in the first two minutes, then move on.',
  },
  {
    key: 'block-a',
    startMin: 10 * 60 + 30,
    endMin: 12 * 60 + 30,
    title: 'Main program block A',
    detail: 'MC keeps a visible clock for every speaker.',
  },
  {
    key: 'lunch',
    startMin: 12 * 60 + 30,
    endMin: 13 * 60 + 30,
    title: 'Lunch and community fair',
    detail: 'Volunteers eat first while the site is calm.',
  },
  {
    key: 'block-b',
    startMin: 13 * 60 + 30,
    endMin: 15 * 60 + 30,
    title: 'Program block B and workshops',
    detail: 'Two tracks maximum; printed signs at both entrances.',
  },
  {
    key: 'closing',
    startMin: 15 * 60 + 30,
    endMin: 16 * 60 + 15,
    title: 'Closing circle and thank-yous',
    detail: 'Name every volunteer group out loud.',
  },
  {
    key: 'teardown',
    startMin: 16 * 60 + 15,
    endMin: 17 * 60 + 30,
    title: 'Teardown and waste sort',
    detail: 'Weigh in before volunteers go home, not the next day.',
  },
];

const MILESTONE_TEMPLATES: Readonly<Record<EventType, readonly MilestoneTemplate[]>> = {
  wedding: WEDDING_MILESTONES,
  birthday: BIRTHDAY_MILESTONES,
  community: COMMUNITY_MILESTONES,
};

const DAY_OF_TEMPLATES: Readonly<Record<EventType, readonly DayOfTemplate[]>> = {
  wedding: WEDDING_DAY_OF,
  birthday: BIRTHDAY_DAY_OF,
  community: COMMUNITY_DAY_OF,
};

/* -------------------------------- generators ------------------------------- */

/**
 * Backward-planned milestones for an event.
 * `todayIso` is injected so the function stays pure and testable.
 */
export function generateMilestones(
  eventType: EventType,
  eventIso: string,
  todayIso: string,
): TimelineItem[] {
  const eventTime = parseIsoDate(eventIso).getTime();
  const todayTime = parseIsoDate(todayIso).getTime();
  const eventIsFutureOrToday = eventTime >= todayTime;

  return (MILESTONE_TEMPLATES[eventType] ?? []).map((seed, index) => {
    const naturalDate = shiftLead(eventIso, seed.lead);
    const naturalTime = parseIsoDate(naturalDate).getTime();
    // Compress: tasks that would have been due before today are pulled forward
    // to today and flagged, unless the whole event is already in the past.
    const compress = eventIsFutureOrToday && naturalTime < todayTime;

    return {
      id: `m-${seed.key}`,
      phase: 'milestone',
      title: seed.title,
      detail: seed.detail,
      dueDate: compress ? todayIso : naturalDate,
      done: false,
      order: index,
      compressed: compress,
    } satisfies TimelineItem;
  });
}

/** Hour-by-hour day-of programme for an event type. */
export function generateDayOf(eventType: EventType): TimelineItem[] {
  return (DAY_OF_TEMPLATES[eventType] ?? []).map((slot, index) => ({
    id: `d-${slot.key}`,
    phase: 'dayof',
    title: slot.title,
    detail: slot.detail,
    startMin: slot.startMin,
    endMin: slot.endMin,
    done: false,
    order: index,
    compressed: false,
  }));
}

/** Every timeline item for a fresh plan: milestones first, then the programme. */
export function generateTimeline(
  eventType: EventType,
  eventIso: string,
  todayIso: string,
): TimelineItem[] {
  return [...generateMilestones(eventType, eventIso, todayIso), ...generateDayOf(eventType)];
}

/** True when a due date is before "today" (used for the overdue badge). */
export function isOverdue(dueDate: string | undefined, todayIso: string): boolean {
  if (!dueDate) return false;
  return daysBetween(todayIso, dueDate) < 0;
}
