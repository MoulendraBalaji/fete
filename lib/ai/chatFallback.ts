/**
 * Deterministic answer for "Ask the Planner" when no model is reachable.
 *
 * It reads the same token-budgeted digest the model would have received, so it
 * can still answer the most common questions (affordability, guest-count
 * changes, what to book next) with the user's real numbers. Answers are emitted
 * in small chunks to keep the streaming UX identical to the AI path.
 */
import type { Plan } from '../schemas/plan';
import { computeLedger } from '../domain/budget';
import { formatMoney } from '../domain/money';
import { isOverdue } from '../domain/timeline';

/** Small chunks so the client can render progressively. */
function chunk(text: string): string[] {
  const words = text.split(/(\s+)/);
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    current += word;
    if (current.length >= 18) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Keyword routing keeps the offline answers genuinely useful. */
export function fallbackChatAnswer(message: string, context: string): string[] {
  const text = message.toLowerCase();

  if (/\b(afford|budget|cost|expensive|cheap|money)\b/.test(text)) {
    return chunk(budgetAnswer(context));
  }
  if (/\b(guests?|headcount|more people|invite)\b/.test(text)) {
    return chunk(guestAnswer(context));
  }
  if (/\b(next|first|book|now|soon|order)\b/.test(text)) {
    return chunk(nextAnswer(context));
  }
  return chunk(generalAnswer(context));
}

function digestValue(context: string, label: string): string | undefined {
  const line = context.split('\n').find((candidate) => candidate.startsWith(label));
  return line?.slice(label.length).trim();
}

function budgetAnswer(context: string): string {
  const totals = digestValue(context, 'Planned total:');
  return [
    'I can work this out from your ledger, though I am running without the AI model right now.',
    '',
    totals ? `Your ledger reads: ${totals}.` : 'Open the Ledger tab for the exact figures.',
    'Open the Ledger tab and try two things:',
    '- Trim the two largest lines by 10 percent and watch the remaining figure move.',
    '- Protect contingency — it is the only category that absorbs a surprise without breaking the plan.',
    'If you tell me the number you are trying to hit, I can suggest which lines to shift.',
  ].join('\n');
}

function guestAnswer(context: string): string {
  const guests = digestValue(context, 'Guests:');
  return [
    guests ? `You are planning for ${guests}.` : 'Add your guest count to see this precisely.',
    'Guest count moves catering, seating, favours and invitations — almost nothing else.',
    'A good rule of thumb: every 10 extra guests adds roughly 3 to 5 percent to the food and drink line.',
    'When you change the guest count in the brief, the Ledger re-allocates automatically and keeps the same total.',
  ].join('\n');
}

function nextAnswer(context: string): string {
  const next = digestValue(context, 'Next:');
  return [
    'Without the model I can still read your timeline.',
    next
      ? `Your earliest open milestone is: ${next}.`
      : 'Open the Countdown tab for your milestones.',
    'Work in this order every time: date and headcount locked → venue → food → the two vendors you would be saddest to lose.',
    'Anything inside two weeks gets booked this week, even if it costs slightly more.',
  ].join('\n');
}

function generalAnswer(context: string): string {
  const milestones = digestValue(context, 'Milestones:');
  return [
    'I am answering from your plan without the AI model, so this is a standard reply.',
    milestones ? `Progress so far — ${milestones}.` : '',
    'Ask me about affordability, what to book next, or what happens if your guest count changes.',
    'Your plan is fully editable meanwhile: every amount, date and vendor is yours to change.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Convenience for the chat route: builds the digest from a plan so the offline
 * path and the AI path reason from exactly the same wording.
 */
export function digestForOfflineAnswer(
  plan: Plan,
  todayIso: string,
  summarize: (p: Plan, t: string) => string,
): string {
  const ledger = computeLedger(plan.brief, plan.budget.rows);
  const overdue = plan.timeline.items.filter((item) => isOverdue(item.dueDate, todayIso)).length;
  return `${summarize(plan, todayIso)}\nOverdue milestones: ${overdue}\nSpend logged: ${formatMoney(
    ledger.actualTotalMinor,
    plan.brief.currency,
  )}`;
}
