/**
 * Token-budgeted plan digest for the chat panel.
 *
 * The model only needs the facts that change its advice, so the digest is built
 * from ranked lines: if it exceeds the budget, the least useful sections are
 * dropped before anything is hard-truncated. At ~4 characters per English
 * token, the default cap is roughly a thousand tokens of context.
 */
import type { Brief } from '../schemas/brief';
import type { Plan } from '../schemas/plan';
import { TEXT_LIMITS } from '../schemas/core';
import { computeLedger } from './budget';
import { formatPlanDate } from './plan';
import { daysBetween, formatMinutesOfDay, isOverdue } from './timeline';

interface DigestLine {
  /** Higher = keep longer when trimming to fit the token budget. */
  rank: number;
  text: string;
}

function briefLines(brief: Brief): DigestLine[] {
  const lines: DigestLine[] = [
    {
      rank: 100,
      text: `Event: ${brief.eventType} on ${formatPlanDate(brief.date)} in ${brief.location}`,
    },
    { rank: 95, text: `Guests: ${brief.guestCount}` },
    {
      rank: 95,
      text: `Budget: ${brief.budgetMinor} minor units of ${brief.currency} (amounts are integers in the smallest unit)`,
    },
  ];
  if (brief.theme) lines.push({ rank: 70, text: `Theme/style: ${brief.theme}` });
  if (brief.considerations)
    lines.push({ rank: 85, text: `Cultural/dietary: ${brief.considerations}` });
  if (brief.mustHaves.length)
    lines.push({ rank: 80, text: `Must-haves: ${brief.mustHaves.join('; ')}` });
  if (brief.avoid.length) lines.push({ rank: 80, text: `Avoid: ${brief.avoid.join('; ')}` });
  if (brief.priorities.length)
    lines.push({ rank: 75, text: `Priorities: ${brief.priorities.join(', ')}` });
  return lines;
}

function budgetLines(plan: Plan): DigestLine[] {
  const ledger = computeLedger(plan.brief, plan.budget.rows);
  const bySize = [...ledger.rows].sort((a, b) => b.plannedMinor - a.plannedMinor).slice(0, 6);
  const breakdown = bySize
    .map((row) => `${row.label} ${row.plannedMinor}/${row.actualMinor}`)
    .join('; ');
  return [
    { rank: 90, text: `Ledger (planned/actual minor units): ${breakdown}` },
    {
      rank: 88,
      text: `Planned total: ${ledger.plannedTotalMinor}; actual total: ${ledger.actualTotalMinor}; unallocated: ${ledger.unallocatedMinor}`,
    },
  ];
}

function progressLines(plan: Plan, todayIso: string): DigestLine[] {
  const milestones = plan.timeline.items.filter((item) => item.phase === 'milestone');
  const done = milestones.filter((item) => item.done).length;
  const overdue = milestones.filter((item) => isOverdue(item.dueDate, todayIso)).length;
  const next = milestones.find((item) => !item.done);
  const dayStart = plan.timeline.items.find((item) => item.phase === 'dayof');
  const lines: DigestLine[] = [
    { rank: 82, text: `Milestones: ${done}/${milestones.length} done, ${overdue} overdue` },
  ];
  if (next?.dueDate) {
    lines.push({
      rank: 84,
      text: `Next: "${next.title}" due ${next.dueDate} (${daysBetween(todayIso, next.dueDate)} days out)`,
    });
  }
  if (dayStart?.startMin !== undefined) {
    lines.push({
      rank: 60,
      text: `Day-of programme starts ${formatMinutesOfDay(dayStart.startMin)}`,
    });
  }
  return lines;
}

function vendorLines(plan: Plan): DigestLine[] {
  const counts = new Map<string, number>();
  for (const vendor of plan.vendors)
    counts.set(vendor.status, (counts.get(vendor.status) ?? 0) + 1);
  const summary = [...counts.entries()].map(([status, n]) => `${n} ${status}`).join(', ');
  const quotedTotal = plan.vendors.reduce((total, vendor) => total + vendor.quoteMinor, 0);
  const booked = plan.vendors.filter(
    (vendor) => vendor.status === 'booked' || vendor.status === 'paid',
  );
  const lines: DigestLine[] = [
    { rank: 78, text: `Vendors: ${summary}; quoted total ${quotedTotal}` },
  ];
  if (booked.length) {
    lines.push({
      rank: 76,
      text: `Booked: ${booked.map((vendor) => `${vendor.label} (${vendor.name || 'name TBC'})`).join('; ')}`,
    });
  }
  return lines;
}

function ideaLines(plan: Plan): DigestLine[] {
  const pinned = plan.ideas.filter((idea) => idea.pinned && !idea.dismissed);
  if (!pinned.length) return [];
  return [{ rank: 72, text: `Pinned ideas: ${pinned.map((idea) => idea.title).join('; ')}` }];
}

/**
 * Builds the chat context string for a plan, capped at `maxChars`.
 * `todayIso` is injected so tests are deterministic.
 */
export function summarizePlan(
  plan: Plan,
  todayIso: string,
  maxChars: number = TEXT_LIMITS.chatContext,
): string {
  const sections: DigestLine[][] = [
    briefLines(plan.brief),
    budgetLines(plan),
    progressLines(plan, todayIso),
    vendorLines(plan),
    ideaLines(plan),
  ];

  let lines = sections.flat();
  let text = lines.map((line) => line.text).join('\n');

  // Drop the least important sections first; never below the brief itself.
  while (text.length > maxChars && lines.some((line) => line.rank < 75)) {
    let lowestRank = Number.POSITIVE_INFINITY;
    for (const line of lines) lowestRank = Math.min(lowestRank, line.rank);
    const index = lines.findIndex((line) => line.rank === lowestRank);
    if (index >= 0) lines = lines.filter((_, i) => i !== index);
    text = lines.map((line) => line.text).join('\n');
  }

  if (text.length > maxChars) {
    text = `${text.slice(0, Math.max(0, maxChars - 1))}…`;
  }
  return text;
}
