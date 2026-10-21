/**
 * Deterministic fallbacks for every AI section.
 *
 * When the model is unavailable (no credentials, timeout, unparseable output,
 * rate limit) the app still has to be a *planning app*. Each fallback is built
 * from the same engines and templates as the primary path, personalised with
 * the user's own words, and labelled as a standard plan in the UI.
 *
 * Pure and synchronous — no I/O.
 */
import type { Brief } from '../schemas/brief';
import type { BudgetRow } from '../schemas/plan';
import type { AiBudgetAdvice, AiIdea, AiVendorTips } from '../schemas/api';
import { budgetTemplateFor } from '../domain/budget';
import { formatMoney } from '../domain/money';
import { vendorCategoryFor } from '../domain/vendors';

const EVENT_NOUNS: Readonly<Record<Brief['eventType'], string>> = {
  wedding: 'wedding',
  birthday: 'birthday',
  community: 'community event',
};

function themeOrFallback(brief: Brief): string {
  return brief.theme.trim() || `${brief.guestCount}-guest ${EVENT_NOUNS[brief.eventType]}`;
}

/** Six brief-aware ideas covering the kinds the AI would have returned. */
export function fallbackIdeas(brief: Brief, count = 6): AiIdea[] {
  const theme = themeOrFallback(brief);
  const diet = brief.considerations.trim();
  const place = brief.location.split(',')[0]?.trim() || brief.location;
  const perHead = Math.round(brief.budgetMinor / Math.max(1, brief.guestCount));

  const pool: AiIdea[] = [
    {
      kind: 'theme',
      title: `Carry “${theme}” through one repeated detail`,
      body: `Pick a single motif — a colour, a flower, a shape — and repeat it on signage, tables and the programme. Repetition reads as intentional design at very little cost.`,
      costTier: 'low',
    },
    {
      kind: 'menu',
      title: 'Two mains, one hero side, clearly labelled',
      body: diet
        ? `Build the menu around your notes (${diet}). Label every dish with allergens and ingredients so guests never have to ask. Estimate: check with your caterer before finalising.`
        : 'Serve two mains and one excellent side rather than a wide buffet. Labels with ingredients and allergens reduce waste and staff time. Estimate: ask your caterer per head.',
      costTier: 'mid',
    },
    {
      kind: 'activity',
      title: 'A hosted moment instead of a schedule',
      body: `One 20-minute hosted activity — a quiz table, a group photo, a toast chain — does more for a ${brief.guestCount}-person room than a full itinerary. Cost is close to zero when a friend hosts it.`,
      costTier: 'free',
    },
    {
      kind: 'decor',
      title: `Make ${place} do the decorating`,
      body: 'Choose one lighting change (warm bulbs or candlelight) and let the venue carry the rest. Lighting is the cheapest way to change how a space feels.',
      costTier: 'low',
    },
    {
      kind: 'favor',
      title: 'One useful keepsake beats a bag of plastic',
      body: `At roughly ${formatMoney(perHead, brief.currency)} per guest of total budget, a single edible or growable favour — seeds, a local sweet, a small plant — lands better than several novelties.`,
      costTier: 'low',
    },
    {
      kind: brief.eventType === 'community' ? 'volunteer' : 'other',
      title:
        brief.eventType === 'community'
          ? 'Name every volunteer role and its hours'
          : 'Give one trusted person the run sheet',
      body:
        brief.eventType === 'community'
          ? 'Nobody volunteers for a vague job. Publish roles with times, a break rota and one escalation number so people can say yes confidently.'
          : 'Hand the day-of schedule to one person who is not you. It removes a hundred small questions from your plate.',
      costTier: 'free',
    },
  ];

  const preferred = brief.priorities.includes('food')
    ? [pool[1], pool[0], pool[2], pool[3], pool[4], pool[5]]
    : pool;

  return preferred.slice(0, Math.max(1, count)).map((idea) => idea) as AiIdea[];
}

/** Starter questions and red flags from the vendor template, brief-aware. */
export function fallbackVendorTips(brief: Brief, categoryKey: string): AiVendorTips {
  const category = vendorCategoryFor(brief.eventType, categoryKey);
  const questions = [...(category?.starterQuestions ?? [])];
  const redFlags = [...(category?.starterRedFlags ?? [])];

  if (brief.considerations.trim()) {
    questions.push(
      'How exactly will you handle our dietary and cultural requirements, in writing?',
    );
  }
  if (brief.guestCount > 200) {
    questions.push('Can you show that you have served a crowd this size before, with references?');
  }
  if (brief.avoid.length) {
    redFlags.push(`Pushes something you asked to avoid (${brief.avoid[0]}).`);
  }
  redFlags.push('Will not put the agreed price, dates and inclusions in one written quote.');

  return {
    questions: dedupe(questions).slice(0, 6),
    redFlags: dedupe(redFlags).slice(0, 5),
  };
}

/** Trade-off explanation derived purely from the ledger numbers. */
export function fallbackBudgetAdvice(brief: Brief, rows: readonly BudgetRow[]): AiBudgetAdvice {
  const template = budgetTemplateFor(brief.eventType);
  const labels = new Map(template.map((category) => [category.key, category.label]));
  const ranked = [...rows]
    .filter((row) => row.key !== 'contingency')
    .sort((a, b) => b.plannedMinor - a.plannedMinor);
  const largest = ranked[0];
  const smallest = ranked[ranked.length - 1];
  const guestSensitive = template.filter((category) => category.guestSensitive).map((c) => c.key);
  const actualTotal = rows.reduce((total, row) => total + row.actualMinor, 0);

  const tradeoffs = [
    largest
      ? `${labels.get(largest.key) ?? largest.key} takes ${formatMoney(largest.plannedMinor, brief.currency)} — the single biggest decision in this plan. Ten percent either way here moves the whole budget.`
      : 'No allocation yet — start by deciding what the day is really for.',
    `Food and drink scale with your ${brief.guestCount} guests, so every ten guests added or removed changes the catering line directly.`,
  ];
  if (smallest && smallest.key !== largest?.key) {
    tradeoffs.push(
      `${labels.get(smallest.key) ?? smallest.key} is the smallest line at ${formatMoney(smallest.plannedMinor, brief.currency)}; trimming it further will not move the needle.`,
    );
  }
  if (actualTotal > 0) {
    tradeoffs.push(
      `You have logged ${formatMoney(actualTotal, brief.currency)} of actual spend so far — keep it beside the plan so surprises show up early.`,
    );
  }

  const suggestions = ranked
    .filter((row) => !guestSensitive.includes(row.key))
    .slice(0, 2)
    .map((row) => ({
      from: row.key,
      to: guestSensitive[0] ?? ranked[0]?.key ?? row.key,
      percentOfTotal: Math.min(
        5,
        Math.max(2, Math.round((row.plannedMinor / brief.budgetMinor) * 10)),
      ),
      rationale: `Only move this if guests matter more than ${(
        labels.get(row.key) ?? row.key
      ).toLowerCase()} to you — it is reversible.`,
    }))
    .filter((suggestion) => suggestion.from !== suggestion.to);

  return {
    headline: `A balanced ${EVENT_NOUNS[brief.eventType]} plan with contingency protected`,
    tradeoffs: tradeoffs.slice(0, 3),
    suggestions,
  };
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
