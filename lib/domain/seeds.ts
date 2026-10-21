/**
 * Seed "demo plans" — one per event type, built from the same engines the live
 * app uses, then dressed with realistic progress so a judge can see a finished
 * dossier in one click without waiting on the model.
 *
 * All money is integer minor units; all dates derive from an injected `today`
 * so a demo never ships an obviously stale countdown.
 */
import { z } from 'zod';
import type { EventType } from '../schemas/core';
import type { CostTier, Idea, IdeaKind, Plan, VendorStatus } from '../schemas/plan';
import { briefSchema, type Brief } from '../schemas/brief';
import { createPlan } from './plan';

/** Raw (pre-parse) brief shape, so seeds can be written without branded values. */
type BriefInput = z.input<typeof briefSchema>;

interface VendorSpec {
  status: VendorStatus;
  quoteRatio?: number;
  name?: string;
  notes?: string;
}

interface DemoSeed {
  brief: BriefInput;
  doneMilestones: number;
  actualRatios: Readonly<Record<string, number>>;
  vendors: Readonly<Record<string, VendorSpec>>;
  ideas: ReadonlyArray<{
    id: string;
    kind: IdeaKind;
    title: string;
    body: string;
    costTier: CostTier;
    pinned: boolean;
  }>;
}

/** Whole days from today, as `YYYY-MM-DD`. */
function inDays(todayIso: string, days: number): string {
  const date = new Date(`${todayIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function applyActuals(
  plan: Plan,
  ratios: Readonly<Record<string, number>>,
): Plan['budget']['rows'] {
  return plan.budget.rows.map((row) => {
    const ratio = ratios[row.key] ?? 0;
    return { ...row, actualMinor: ratio > 0 ? Math.floor(row.plannedMinor * ratio) : 0 };
  });
}

function seedIdeas(specs: DemoSeed['ideas'], source: Idea['source'] = 'seed'): Idea[] {
  return specs.map((spec) => ({
    id: spec.id,
    kind: spec.kind,
    title: spec.title,
    body: spec.body,
    costTier: spec.costTier,
    pinned: spec.pinned,
    dismissed: false,
    source,
  }));
}

const WEDDING: DemoSeed = {
  brief: {
    eventType: 'wedding',
    date: '2027-06-19',
    location: 'Lisbon, Portugal',
    guestCount: 90,
    budgetMinor: 2_400_000,
    currency: 'EUR',
    theme: 'Candlelit garden dinner — oxblood, blush and olive',
    considerations:
      'Six vegetarian guests, one vegan; one Hindu ceremony element welcomed; no pork on the menu.',
    mustHaves: [
      'Live band for the first dance',
      'Late-night pastel de nata cart',
      'Photo booth with printed strips',
    ],
    avoid: ['No sparklers indoors', 'No fish buffet', 'No formal receiving line'],
    priorities: ['food', 'photos', 'music'],
  },
  doneMilestones: 3,
  actualRatios: { venue: 0.3, photography: 0.2, stationery: 1, decor: 0.15, favours: 0.25 },
  vendors: {
    venue: {
      status: 'paid',
      name: 'Quinta do Olival',
      quoteRatio: 1,
      notes: 'Deposit paid; balance due 1 March. Corkage waived for the welcome dinner.',
    },
    caterer: {
      status: 'quoted',
      name: 'Mesa Lenta',
      quoteRatio: 0.96,
      notes: 'Tasting booked. Full vegetarian table confirmed in writing.',
    },
    photographer: {
      status: 'booked',
      name: 'Two Rivers Photo',
      quoteRatio: 1,
      notes: 'Nine hours, second shooter included, gallery in 6 weeks.',
    },
    music: {
      status: 'quoted',
      name: 'The Late Set',
      quoteRatio: 1,
      notes: 'Two sets + DJ between. Need the must-play list by May.',
    },
    florist: {
      status: 'contacted',
      name: 'Rua Verde',
      quoteRatio: 0.9,
      notes: 'Seasonal olives and roses; waiting on a centrepiece breakdown.',
    },
    videographer: { status: 'todo' },
    cake: {
      status: 'contacted',
      name: 'Doce Rua',
      quoteRatio: 1,
      notes: 'Vegan tier confirmed; allergen sheet requested.',
    },
    stationer: {
      status: 'paid',
      name: 'Letterpress Alfama',
      quoteRatio: 1,
      notes: 'Invitations printed, 92 envelopes addressed in two languages.',
    },
    transport: { status: 'quoted', quoteRatio: 1, name: 'Two shuttles, hotel ↔ venue' },
    officiant: {
      status: 'booked',
      name: 'Celebrant — Ana R.',
      quoteRatio: 1,
      notes: 'Civil ceremony + one cultural element, script review in May.',
    },
  },
  ideas: [
    {
      id: 'seed-wed-1',
      kind: 'theme',
      title: 'Long tables under olive trees',
      body: 'One continuous table down the garden axis: easier conversation, fewer centrepieces, and it photographs like a painting.',
      costTier: 'mid',
      pinned: true,
    },
    {
      id: 'seed-wed-2',
      kind: 'menu',
      title: 'Sharing boards with a late-night custard tart cart',
      body: 'Family-style service honours the vegetarian table, cuts plating labour, and the 11pm cart gives guests a second wind.',
      costTier: 'mid',
      pinned: true,
    },
    {
      id: 'seed-wed-3',
      kind: 'decor',
      title: 'Oxblood runner + taper candles',
      body: 'A single fabric runner per table with odd-numbered tapers: the whole look lands for the cost of one installation.',
      costTier: 'low',
      pinned: false,
    },
    {
      id: 'seed-wed-4',
      kind: 'activity',
      title: 'Lawn games during the drinks hour',
      body: 'Pétanque and a card quiz occupy the guests who never dance, and they fill the photographer’s quiet half-hour.',
      costTier: 'low',
      pinned: false,
    },
    {
      id: 'seed-wed-5',
      kind: 'favor',
      title: 'Mini olive-oil bottles, hand-tagged',
      body: 'Local, useful, and the tags double as place cards — one purchase instead of two.',
      costTier: 'low',
      pinned: false,
    },
    {
      id: 'seed-wed-6',
      kind: 'other',
      title: 'A letter-writing table for the couple',
      body: 'Guests leave letters in a vintage suitcase; costs nothing and becomes the keepsake you actually keep.',
      costTier: 'free',
      pinned: false,
    },
  ],
};

const BIRTHDAY: DemoSeed = {
  brief: {
    eventType: 'birthday',
    date: '2026-12-05',
    location: 'Bristol, UK',
    guestCount: 45,
    budgetMinor: 540_000,
    currency: 'GBP',
    theme: 'Backyard night market — lanterns, paper bunting, street-food stalls',
    considerations:
      'One guest coeliac, two dairy-free; the birthday person hates being sung to in public.',
    mustHaves: ['A proper sound system', 'Photo corner with instant prints', 'Dancing until 11pm'],
    avoid: ['No surprise entrance', 'No fondant cake', 'No seating plan — standing only'],
    priorities: ['music', 'food', 'guest-experience'],
  },
  doneMilestones: 4,
  actualRatios: { stationery: 1, invitations: 1, decor: 0.5, cake: 0.3 },
  vendors: {
    venue: {
      status: 'booked',
      name: 'Home garden + marquee',
      quoteRatio: 1,
      notes: 'Marquee measured; neighbours notified about the 11pm finish.',
    },
    caterer: {
      status: 'quoted',
      name: 'Night Market Kitchen',
      quoteRatio: 1,
      notes: 'Gluten-free fryer confirmed separate. Two stalls quoted.',
    },
    cake: {
      status: 'paid',
      name: 'Baker on Willow',
      quoteRatio: 1,
      notes: 'Dairy-free layer ordered, collected 3pm on the day.',
    },
    entertainment: {
      status: 'booked',
      name: 'DJ — Tom K.',
      quoteRatio: 1,
      notes: 'Own PA and lights. Playlists: no fondant-era pop.',
    },
    decor: {
      status: 'contacted',
      quoteRatio: 1,
      notes: 'Lantern hire quotes in; bunting being made by family.',
    },
    photographer: {
      status: 'contacted',
      name: 'Instant-print corner',
      quoteRatio: 1,
      notes: 'Two hours of coverage plus the print station.',
    },
    rentals: {
      status: 'quoted',
      quoteRatio: 1,
      notes: '10 high tables, glassware, two beer barrels.',
    },
    invitations: { status: 'paid', quoteRatio: 1, notes: 'Digital + 12 printed keepsakes.' },
  },
  ideas: [
    {
      id: 'seed-bday-1',
      kind: 'theme',
      title: 'Lantern grid overhead',
      body: 'String a simple square of warm bulbs over the standing area — it turns a garden into a venue after dark.',
      costTier: 'mid',
      pinned: true,
    },
    {
      id: 'seed-bday-2',
      kind: 'menu',
      title: 'Build-your-own bao bar',
      body: 'One filling line, three toppings, and a clearly separated gluten-free station so nobody has to ask twice.',
      costTier: 'mid',
      pinned: true,
    },
    {
      id: 'seed-bday-3',
      kind: 'activity',
      title: 'Karaoke bracket, 90 minutes',
      body: 'A seeded bracket keeps songs short and gives quieter guests a scheduled turn at the mic.',
      costTier: 'low',
      pinned: false,
    },
    {
      id: 'seed-bday-4',
      kind: 'decor',
      title: 'Marigold garlands on the fence line',
      body: 'One colour, one flower, repeated: the market look reads instantly on camera.',
      costTier: 'low',
      pinned: false,
    },
    {
      id: 'seed-bday-5',
      kind: 'favor',
      title: 'Seed packets stamped with the date',
      body: 'Costs less than sweets, survives the trip home, and guests plant the memory.',
      costTier: 'free',
      pinned: false,
    },
  ],
};

const COMMUNITY: DemoSeed = {
  brief: {
    eventType: 'community',
    date: '2027-01-23',
    location: 'Riverside Park, Oakland',
    guestCount: 320,
    budgetMinor: 1_850_000,
    currency: 'USD',
    theme: 'Neighbourhood river festival — three stages, kids’ zone, repair café',
    considerations:
      'English and Spanish signage; step-free route along the east path; halal and vegetarian options at every stall.',
    mustHaves: ['Free entry', 'Quiet hour 10–11am', 'Shade and water stations'],
    avoid: [
      'No single-use plastic bottles',
      'No amplified music before 11am',
      'No sponsor logos on the stage',
    ],
    priorities: ['guest-experience', 'value'],
  },
  doneMilestones: 4,
  actualRatios: {
    'venue-permits': 0.5,
    'marketing-outreach': 0.35,
    documentation: 0.5,
    accessibility: 0.4,
  },
  vendors: {
    'site-permits': {
      status: 'booked',
      name: 'City park permit + insurance',
      quoteRatio: 1,
      notes: 'Permit approved; certificate names the city as additional insured.',
    },
    caterer: {
      status: 'quoted',
      name: 'Community kitchen collective',
      quoteRatio: 0.95,
      notes: 'Halal and vegetarian trays priced separately.',
    },
    'av-stage': {
      status: 'contacted',
      quoteRatio: 1,
      notes: 'Noise limit 85dB at the east fence — confirmed in writing.',
    },
    rentals: {
      status: 'quoted',
      quoteRatio: 1,
      notes: 'Two 20×20 tents, 20 tables, accessible portable toilet unit.',
    },
    insurance: { status: 'paid', quoteRatio: 1, notes: '$2M public liability certificate issued.' },
    print: {
      status: 'paid',
      name: 'Bilingual poster run',
      quoteRatio: 1,
      notes: '400 posters + 12 A-frame signs, English/Spanish.',
    },
    photographer: {
      status: 'contacted',
      quoteRatio: 1,
      notes: 'Consent signage agreed; gallery for the annual report.',
    },
    'first-aid': { status: 'todo' },
  },
  ideas: [
    {
      id: 'seed-com-1',
      kind: 'outreach',
      title: 'Flyers where people already stand',
      body: 'Library holds, barbershop counters and bus stops beat an ad buy for a 320-person event — and cost less.',
      costTier: 'low',
      pinned: true,
    },
    {
      id: 'seed-com-2',
      kind: 'volunteer',
      title: 'Welcome desk on 45-minute rotations',
      body: 'Two people per shift, rotation posted in advance: fresh voices, nobody frozen for six hours.',
      costTier: 'free',
      pinned: true,
    },
    {
      id: 'seed-com-3',
      kind: 'menu',
      title: 'Three-culture potluck table with printed labels',
      body: 'Labels carry the dish, the contributor and allergens — inclusion and safety in one card.',
      costTier: 'low',
      pinned: false,
    },
    {
      id: 'seed-com-4',
      kind: 'activity',
      title: 'Kids’ craft corner beside the repair café',
      body: 'Parents can queue for repairs while children build wind-spinners from the offcuts.',
      costTier: 'low',
      pinned: false,
    },
    {
      id: 'seed-com-5',
      kind: 'decor',
      title: 'Banner made by the school art club',
      body: 'Cheaper than printing, and the makers become your first amplifiers.',
      costTier: 'free',
      pinned: false,
    },
    {
      id: 'seed-com-6',
      kind: 'other',
      title: 'Quiet hour 10–11am with reduced PA',
      body: 'Protects neurodivergent guests and gives elders a gentler window — then the day can open up.',
      costTier: 'free',
      pinned: false,
    },
  ],
};

const DEMOS: Readonly<Record<EventType, DemoSeed>> = {
  wedding: WEDDING,
  birthday: BIRTHDAY,
  community: COMMUNITY,
};

/**
 * Default demo briefs, one per event type — the landing page uses these so the
 * "try a sample" buttons fill the wizard with a realistic scenario.
 */
export const DEMO_BRIEFS: Readonly<Record<EventType, BriefInput>> = {
  wedding: WEDDING.brief,
  birthday: BIRTHDAY.brief,
  community: COMMUNITY.brief,
};

/** How far ahead each demo event sits, so samples never look stale. */
const DEMO_DAYS_OUT: Readonly<Record<EventType, number>> = {
  wedding: 300,
  birthday: 42,
  community: 92,
};

/** A demo brief with a date relative to `todayIso`. */
export function demoBriefFor(eventType: EventType, todayIso: string) {
  return briefSchema.parse({
    ...DEMO_BRIEFS[eventType],
    date: inDays(todayIso, DEMO_DAYS_OUT[eventType]),
  });
}

export interface DemoPlanOptions {
  todayIso?: string;
  now?: number;
  id?: string;
}

/**
 * Demo dates stay in the future relative to "today" so the countdown reads
 * sensibly whenever the repo is cloned.
 */
function relativeDateFor(eventType: EventType, todayIso: string): string {
  return inDays(todayIso, DEMO_DAYS_OUT[eventType]);
}

/**
 * Vendor quotes in the demo data are expressed as a ratio of the *engine's*
 * planned amount for that vendor's budget line, so the demo stays coherent
 * even if the allocation weights are tuned later. Applied last so it reads
 * the freshly seeded budget rows.
 */
function applyDemoVendorQuotes(plan: Plan, seed: DemoSeed): void {
  plan.vendors = plan.vendors.map((vendor) => {
    const spec = seed.vendors[vendor.categoryKey];
    if (!spec) return vendor;
    const row = plan.budget.rows.find((candidate) => candidate.key === vendor.budgetKey);
    const planned = row?.plannedMinor ?? 0;
    const quote =
      spec.quoteRatio !== undefined ? Math.floor(planned * spec.quoteRatio) : vendor.quoteMinor;
    return {
      ...vendor,
      status: spec.status,
      name: spec.name ?? vendor.name,
      notes: spec.notes ?? vendor.notes,
      quoteMinor: quote,
      tipsSource: 'seed' as const,
    };
  });
}

/** Builds the demo dossier for an event type (schema-valid, engine-derived). */
export function buildDemoPlan(eventType: EventType, options: DemoPlanOptions = {}): Plan {
  const todayIso = options.todayIso ?? new Date().toISOString().slice(0, 10);
  const now = options.now ?? Date.now();
  const seed: DemoSeed = DEMOS[eventType];
  const brief: Brief = briefSchema.parse({
    ...seed.brief,
    date: relativeDateFor(eventType, todayIso),
  });

  const base = createPlan(brief, { id: options.id, now, todayIso });
  const demo: Plan = {
    ...base,
    budget: { rows: applyActuals(base, seed.actualRatios) },
    timeline: {
      items: base.timeline.items.map((item) =>
        item.phase === 'milestone' && item.order < seed.doneMilestones
          ? { ...item, done: true }
          : item,
      ),
    },
    ideas: seedIdeas(seed.ideas),
    offlineSections: [],
  };
  applyDemoVendorQuotes(demo, seed);
  return demo;
}
