/**
 * The Roster — vendor categories per event type.
 *
 * Pure data + a factory. The AI personalises *questions* per category but the
 * category list itself is deterministic, so a plan is complete before any
 * model call happens (and when the model is unavailable).
 */
import type { EventType } from '../schemas/core';
import type { Vendor } from '../schemas/plan';

export interface VendorCategory {
  key: string;
  label: string;
  /** Budget line this vendor's spend should be booked against. */
  budgetKey: string;
  /** Shown in the roster to explain what "booked" means for this category. */
  hint: string;
  /** Generic starter questions shown even when the AI is offline. */
  starterQuestions: readonly string[];
  starterRedFlags: readonly string[];
}

const WEDDING_VENDORS: readonly VendorCategory[] = [
  {
    key: 'venue',
    label: 'Venue',
    budgetKey: 'venue',
    hint: 'Site hire, deposits, curfews and wet-weather backup.',
    starterQuestions: [
      'What is included in the hire, and what carries an extra charge?',
      'What is the deposit, the balance date, and the cancellation window?',
      'What happens if it rains, and who decides?',
    ],
    starterRedFlags: [
      'No written quote after the second conversation',
      'Pressure to pay a deposit the same day',
    ],
  },
  {
    key: 'caterer',
    label: 'Caterer',
    budgetKey: 'catering',
    hint: 'Menu, tastings, dietary coverage and corkage.',
    starterQuestions: [
      'How do you price per head, and what triggers an overage?',
      'Can you plate for every dietary and cultural need on my list?',
      'Who leads on the day — and what is their phone number?',
    ],
    starterRedFlags: ['Won’t put allergy handling in writing', 'No tasting before the contract'],
  },
  {
    key: 'photographer',
    label: 'Photographer',
    budgetKey: 'photography',
    hint: 'Style, hours, delivery and rights to your images.',
    starterQuestions: [
      'Can I see a full wedding gallery, not just highlights?',
      'How many hours, how many edited images, and by when?',
      'What happens if you cannot attend — who stands in?',
    ],
    starterRedFlags: ['Only shows curated blog posts', 'No backup body or second shooter plan'],
  },
  {
    key: 'videographer',
    label: 'Videographer',
    budgetKey: 'photography',
    hint: 'Often shares the photography budget line.',
    starterQuestions: [
      'What is the final film length and delivery format?',
      'Do you coordinate with the photographer for timeline slots?',
    ],
    starterRedFlags: ['Raw-footage delivery promised but not in writing'],
  },
  {
    key: 'florist',
    label: 'Florist',
    budgetKey: 'decor',
    hint: 'Seasonality, installation and teardown.',
    starterQuestions: [
      'Which flowers are in season for my date, and what substitutes if short?',
      'Is delivery, setup and teardown included?',
    ],
    starterRedFlags: ['No breakdown between flowers and labour'],
  },
  {
    key: 'music',
    label: 'Band or DJ',
    budgetKey: 'entertainment',
    hint: 'Sets, requests, equipment and end time.',
    starterQuestions: [
      'What are your sets and breaks, and who emcees between them?',
      'Do you bring your own PA, lighting and a spare laptop?',
    ],
    starterRedFlags: [
      'Won’t share a contract with times and numbers',
      'Every review mentions them arriving late',
    ],
  },
  {
    key: 'cake',
    label: 'Cake baker',
    budgetKey: 'favours',
    hint: 'Portion counts, allergens and delivery.',
    starterQuestions: [
      'How many portions does this size actually serve?',
      'How are allergens and dietary variants handled in your kitchen?',
    ],
    starterRedFlags: ['No food-safety registration to show you'],
  },
  {
    key: 'stationer',
    label: 'Stationer',
    budgetKey: 'stationery',
    hint: 'Invitations, menus and day-of print.',
    starterQuestions: [
      'What is the proof-to-print timeline, and how many revisions are included?',
      'Can you match wording for guests in more than one language?',
    ],
    starterRedFlags: ['No physical or digital proof before printing'],
  },
  {
    key: 'transport',
    label: 'Transport',
    budgetKey: 'transport',
    hint: 'Cars, shuttles and guest parking.',
    starterQuestions: [
      'How long is the booking, and what counts as waiting time?',
      'What is the backup if a vehicle breaks down?',
    ],
    starterRedFlags: ['Only a phone number and a price — no company name'],
  },
  {
    key: 'officiant',
    label: 'Officiant or celebrant',
    budgetKey: 'planning-support',
    hint: 'Ceremony words, rehearsals and paperwork.',
    starterQuestions: [
      'Are you legally authorised where we are marrying?',
      'How many ceremonies do you take on the same day?',
    ],
    starterRedFlags: ['Cannot confirm legal requirements for your region'],
  },
];

const BIRTHDAY_VENDORS: readonly VendorCategory[] = [
  {
    key: 'venue',
    label: 'Space',
    budgetKey: 'venue',
    hint: 'Hire, home setup, noise rules and access.',
    starterQuestions: [
      'What is included in the hire and what is charged on top?',
      'What are the noise and finish-time rules?',
    ],
    starterRedFlags: ['No written confirmation of the date and time'],
  },
  {
    key: 'caterer',
    label: 'Food and drink',
    budgetKey: 'catering',
    hint: 'Per-head pricing, service and dietary cover.',
    starterQuestions: [
      'What is the per-head price, and how many guests does it assume?',
      'How do you label and separate allergen-free plates?',
    ],
    starterRedFlags: ['No sample menu or tasting option'],
  },
  {
    key: 'cake',
    label: 'Cake',
    budgetKey: 'cake',
    hint: 'Size, allergens and delivery time.',
    starterQuestions: [
      'How many slices at this size?',
      'What time will you deliver, and how is it set up?',
    ],
    starterRedFlags: ['No ingredients list offered for allergy questions'],
  },
  {
    key: 'entertainment',
    label: 'Entertainment',
    budgetKey: 'entertainment',
    hint: 'Performer, DJ, games or activities.',
    starterQuestions: [
      'What do you need from us on the day — space, power, sound?',
      'Is the fee fixed, or are travel costs added later?',
    ],
    starterRedFlags: ['Refuses to confirm the fee in writing'],
  },
  {
    key: 'decor',
    label: 'Decor and theme',
    budgetKey: 'decor',
    hint: 'Balloons, banners, table settings, teardown.',
    starterQuestions: [
      'Who sets up and who takes it all down?',
      'Are the materials reusable, and what happens to them after?',
    ],
    starterRedFlags: ['No photo of previous work at a similar scale'],
  },
  {
    key: 'photographer',
    label: 'Photography',
    budgetKey: 'photography',
    hint: 'Hours, edits and delivery date.',
    starterQuestions: [
      'How many hours do you cover, and how many edited images?',
      'When will the gallery be ready?',
    ],
    starterRedFlags: ['No contract covering delivery time'],
  },
  {
    key: 'rentals',
    label: 'Rentals',
    budgetKey: 'logistics',
    hint: 'Tables, chairs, glassware, delivery windows.',
    starterQuestions: [
      'What are the delivery and collection windows?',
      'Who is responsible for damage or missing items?',
    ],
    starterRedFlags: ['Delivery fee revealed only after you book'],
  },
  {
    key: 'invitations',
    label: 'Invitations',
    budgetKey: 'invitations',
    hint: 'Design, print, postage and reply handling.',
    starterQuestions: [
      'How many proofs are included before printing?',
      'Can you include reply details in more than one language?',
    ],
    starterRedFlags: ['No proof approval step'],
  },
];

const COMMUNITY_VENDORS: readonly VendorCategory[] = [
  {
    key: 'site-permits',
    label: 'Site and permits',
    budgetKey: 'venue-permits',
    hint: 'Council permits, licences and insurance.',
    starterQuestions: [
      'What is the submission deadline, and how long does approval take?',
      'Which insurance certificates do you need from suppliers?',
    ],
    starterRedFlags: ['Verbal approval only, nothing from the council in writing'],
  },
  {
    key: 'caterer',
    label: 'Food and drink',
    budgetKey: 'food-drink',
    hint: 'Volume catering, dietary labelling, volunteer meals.',
    starterQuestions: [
      'How do you price for mixed dietary needs at volume?',
      'Can you serve volunteers before guests?',
    ],
    starterRedFlags: ['No allergen procedure for community-scale service'],
  },
  {
    key: 'av-stage',
    label: 'Stage, AV and sound',
    budgetKey: 'equipment-rentals',
    hint: 'PA, microphones, staging and technicians.',
    starterQuestions: [
      'Is a technician included, and for how many hours?',
      'What is the noise-limit plan for the site?',
    ],
    starterRedFlags: ['No technician offered for a live program'],
  },
  {
    key: 'rentals',
    label: 'Tents, tables and toilets',
    budgetKey: 'equipment-rentals',
    hint: 'Weather cover, seating, accessible facilities.',
    starterQuestions: [
      'What happens to the site if the weather turns?',
      'Are step-free and accessible facilities included?',
    ],
    starterRedFlags: ['No accessible option in the quote'],
  },
  {
    key: 'insurance',
    label: 'Insurance and safety',
    budgetKey: 'venue-permits',
    hint: 'Public liability, first aid and risk assessment.',
    starterQuestions: [
      'What cover level does the site require, and can you certify it?',
      'Who holds the written risk assessment?',
    ],
    starterRedFlags: ['Cannot produce a certificate with your event named on it'],
  },
  {
    key: 'print',
    label: 'Print and outreach',
    budgetKey: 'marketing-outreach',
    hint: 'Posters, signage, translation and flyers.',
    starterQuestions: [
      'What are the print-to-delivery dates for each format?',
      'Can you handle non-Latin scripts in the same file?',
    ],
    starterRedFlags: ['No printer proof for multilingual artwork'],
  },
  {
    key: 'photographer',
    label: 'Documentation',
    budgetKey: 'documentation',
    hint: 'Event photos for the report and next year’s case.',
    starterQuestions: [
      'How many hours and how many edited images?',
      'Do attendees need to be notified about photography?',
    ],
    starterRedFlags: ['No consent or signage plan for photographing the public'],
  },
  {
    key: 'first-aid',
    label: 'First aid',
    budgetKey: 'volunteer-support',
    hint: 'Qualified cover or a trained volunteer team.',
    starterQuestions: [
      'Are your staff qualified and what is their coverage ratio?',
      'Where will the first-aid point be, and how is it signed?',
    ],
    starterRedFlags: ['No named person responsible for first aid'],
  },
];

const VENDOR_TEMPLATES: Readonly<Record<EventType, readonly VendorCategory[]>> = {
  wedding: WEDDING_VENDORS,
  birthday: BIRTHDAY_VENDORS,
  community: COMMUNITY_VENDORS,
};

export function vendorTemplateFor(eventType: EventType): readonly VendorCategory[] {
  return VENDOR_TEMPLATES[eventType] ?? [];
}

export function vendorCategoryFor(eventType: EventType, key: string): VendorCategory | undefined {
  return vendorTemplateFor(eventType).find((category) => category.key === key);
}

/** A fresh, empty roster ("To find" for everything) for a new plan. */
export function createRoster(eventType: EventType): Vendor[] {
  return vendorTemplateFor(eventType).map((category) => ({
    id: `v-${category.key}`,
    categoryKey: category.key,
    label: category.label,
    name: '',
    status: 'todo',
    quoteMinor: 0,
    notes: '',
    budgetKey: category.budgetKey,
    questions: [...category.starterQuestions],
    redFlags: [...category.starterRedFlags],
    tipsSource: 'seed',
  }));
}
