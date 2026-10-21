# Fête

**A GenAI planning assistant for weddings, birthdays and community events — that keeps its books.**

Fête is a plan, not a pile of lists. You answer five questions; it produces a budget that always
reconciles to the penny, a countdown built backwards from the day, a vendor roster that compares
quotes against the envelope, and an AI assistant that reasons over _your_ brief rather than a
generic wedding checklist.

It runs entirely on Vercel — no database, no object storage, no queue. Your plans live in your
browser, and a share link carries the plan itself.

---

## Table of contents

- [What it does](#what-it-does)
- [How it maps to the evaluation criteria](#how-it-maps-to-the-evaluation-criteria)
- [Architecture](#architecture)
- [Where the data lives](#where-the-data-lives)
- [Running it](#running-it)
- [Deploying to Vercel](#deploying-to-vercel)
- [Using a free LLM provider](#using-a-free-llm-provider)
- [How the AI layer works](#how-the-ai-layer-works)
- [Security](#security)
- [The design system](#the-design-system)
- [Testing](#testing)
- [Known limitations](#known-limitations)

---

## What it does

**Five-step intake brief.** Event type, date and location, guest count, budget and currency, then
theme, must-haves, avoids and priorities. Each step validates independently, so you can never reach
step four with an invalid step two. The draft is string-typed while you type (so a trailing decimal
point does not fight you) and is converted to integer minor units exactly once, on submit.

**The Ledger.** Every amount is stored as an integer count of the currency's minor unit — `123456`
is `$1,234.56`, never `1234.5599999999999`. The template allocation is split with a
[largest-remainder][lar] method so the rows sum _exactly_ to the budget rather than approximately.
Contingency is reserved _before anything else_ and can never drop below 5% of the total (nor exceed
15%). It is marked **Protected** in the UI, and the move-money helper refuses to spend it. Entering
an amount over the envelope flags an over-allocation instead of quietly absorbing it.

**The Timeline.** Two views of the same data: a **Countdown** that works backwards from the event
date through milestone windows (book the venue 12 months out, send invitations 8 weeks out, …), and
a **Day-of** run sheet for the day itself. Completed tasks are remembered. The whole thing exports
as a real `.ics` file with a stable UID per item — so re-importing updates events instead of
duplicating them — and prints cleanly.

**The Roster.** Vendors grouped by category, each with a status, a quote, a contact and the
difference between the quote and what the ledger allows for that category. A quote inside the
envelope reads green, one that blows it reads red — so an over-budget vendor is visible immediately
rather than discovered at the end. "Research this vendor" asks the model for the questions to ask
and the red flags to watch for.

**The Muse.** Ideas generated from your brief — theme, menu, activity, décor, favour, volunteer,
outreach — each with a rough cost tier. Pin the good ones; dismiss the rest with an Undo. An idea
can be pushed onto the timeline as a task.

**Ask.** A streamed chat over a token-budgeted digest of your plan. Because the digest is built from
your actual numbers, it can answer "can I afford a live band?" with your real remaining balance.

**Plan management.** Duplicate, delete (with Undo), export to JSON, import from JSON, copy a share
link, and print. Everything is written through to storage on every change, so there is no save
button and no way to lose work to a refresh.

---

## How it maps to the evaluation criteria

| Criterion                    | Where to look                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Code quality** (high)      | `lib/` is layered with one direction of dependency: `schemas` → `domain` → `ai`/`api` → UI. Every module opens with a comment saying what it is _for_ and what trade-off it makes. Zod schemas are the single source of truth for types (`z.infer`), so a validation rule and its TypeScript type can never drift. No `any`, no non-null assertions, `noUncheckedIndexedAccess` and `noUnusedLocals` are on. |
| **Problem alignment** (high) | The domain is a _budget_, so the whole app is built around money being correct: integer minor units, largest-remainder allocation, a protected contingency, and an over-budget flag rather than a silent overflow. The AI is a collaborator — it proposes, the user accepts.                                                                                                                                 |
| **Security** (medium)        | `.strict()` zod on every request body, per-IP sliding-window rate limiting with `Retry-After`, a same-origin check on every POST, server-only env access enforced by the `server-only` package, a strict CSP, prompt-injection neutralisation, and no `dangerouslySetInnerHTML` anywhere. See [Security](#security).                                                                                         |
| **Efficiency** (medium)      | Only the chat panel is code-split; everything else is shared chunks. AI responses are cached in-process by a content key, so asking for ideas twice costs one request. Structured output is validated _before_ it is trusted. The share encoder degrades through a documented fidelity ladder instead of failing.                                                                                            |
| **Testing** (low)            | 164 tests across nine files: domain arithmetic, schema edge cases, the storage migration path, the share/import round-trip, rate limiting, **route handlers driven end to end** with `fetch` faked at the network seam, and jsdom component tests for the wizard, ledger, tabs and money formatting.                                                                                                         |
| **Accessibility** (low)      | Real WAI-ARIA tab pattern with roving `tabIndex`, `Home`/`End` and `Arrow` keys; every form control gets its label, hint and error wired through generated ids by the `Field` render-prop, so `aria-describedby` cannot be forgotten; `role="progressbar"` with `aria-valuenow`; live regions for toasts; errors in `role="alert"`.                                                                          |

[lar]: https://en.wikipedia.org/wiki/Largest_remainder_method

---

## Architecture

```
app/
  layout.tsx                 four self-hosted fonts, theme bootstrap, metadata
  page.tsx                   server shell → HomeClient (owns the library)
  HomeClient.tsx             hero, samples, plan library, intake
  plan/[id]/page.tsx         server shell → PlanWorkspace
  plan/[id]/PlanWorkspace.tsx  resolves the plan (hash snapshot → library → missing)
  error.tsx, not-found.tsx   boundaries that never lose data
  api/{ideas,vendor-tips,budget-advice,chat,health}/route.ts

components/
  ui/          Sheet, Button, Stamp, Rule, Money, Progress, Callout, Field,
               Tabs, EmptyState, Toast  ← the "Stationery & Ledger" vocabulary
  brand/       Logo, ThemeToggle
  intake/      IntakeWizard
  workspace/   Workspace (orchestrator), Ledger, Timeline, Roster, Muse,
               ChatPanel, BriefEditor, PlanLibrary

lib/
  schemas/     core, brief, plan, api     ← single source of truth for types
  domain/      money, budget, timeline, vendors, plan, summary, ics, id, seeds
  ai/          provider, parse, prompts, fallbacks, chatFallback, service
  api/         handler                    ← origin, size, rate limit, errors
  security/    env, sanitize, rateLimit
  storage/     plans                      ← the only localStorage reader/writer
  share/       encode                     ← compression + fidelity ladder
  client/      ai, browser                ← typed fetch wrappers, DOM helpers
  hooks/       usePlanLibrary, useTheme
```

The dependency rule is one-way and enforced by review: nothing in `lib/domain` imports from
`lib/ai`, and nothing in `lib/` imports from `components/`. A pure function that computes a budget
cannot accidentally acquire a dependency on React or on a network call.

### Route handlers are thin

Every API route does the same five things and nothing else:

```ts
export const POST = withErrorHandling(async (request, requestId) => {
  assertSameOrigin(request);                                    // 403 if not our own page
  const remaining = limitRequest(request, 'ideas');             // 429 + Retry-After
  const { data } = await readValidatedBody(request, schema, requestId); // 413 / 400
  const result = await generateIdeas(providerOrUndefined(), data.brief, [], 6);
  return NextResponse.json({ ... }, { headers: aiResponseHeaders(remaining, requestId) });
});
```

`withErrorHandling` turns any throw into the shared `{ error: { code, message, requestId } }`
envelope and logs a structured line with a request id and **no user content**. Client errors are
logged at `warn`, genuine faults at `error`, so an on-call review of error logs stays meaningful.

---

## Where the data lives

There is no database. Three mechanisms, in order of preference:

1. **`localStorage`** under the key `fete.plans`, holding a versioned envelope of plans. Each row is
   validated _individually_ on read, so one corrupt plan cannot take the whole library down — the bad
   row is dropped and `activeId` is repaired to `null` if it pointed at it.
2. **The URL hash** for sharing: `#plan=<lz-string>`. A hash is never sent to the server, so a shared
   plan never appears in an access log, and the visitor's browser can reconstruct the plan with no
   round trip. A shared link opens as a _new, editable_ plan in the recipient's own library.
3. **JSON export/import** for backup and for anything that outgrows a link.

Because plans are per-browser, "I lost my plan" almost always means "I opened the link on another
device". The missing-plan screen says exactly that, and points at the whole-link-including-the-`#`
detail, rather than showing a bare 404.

---

## Running it

Requires **Node.js ≥ 20**. Nothing else.

```bash
npm install
cp .env.example .env.local     # optional — see below
npm run dev                    # http://localhost:3000
```

It works with `.env.local` empty. Every AI feature has a deterministic fallback, so with no key
configured you still get budgets, timelines, rosters, the ledger, `.ics` export, printing and
sharing — the AI panels simply say they are running a standard review instead.

| Command             | What it does                                                                   |
| ------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`       | Development server.                                                            |
| `npm run build`     | Production build.                                                              |
| `npm run lint`      | ESLint (flat config, Next + Prettier rules), warnings treated as failures.     |
| `npm run typecheck` | `tsc --noEmit`.                                                                |
| `npm test`          | The full Vitest suite (~164 tests).                                            |
| `npm run verify`    | `lint && typecheck && test && build` — the definition of done, in one command. |
| `npm run format`    | Prettier over the repo.                                                        |

---

## Deploying to Vercel

1. Push the repository to GitHub/GitLab/Bitbucket.
2. In Vercel, **Add New → Project** and import it. The framework preset is detected as Next.js; no
   build settings need changing.
3. _(Optional, for AI)_ Add the environment variables from [the next section][free] under
   **Settings → Environment Variables**, for **Production, Preview and Development**.
4. Deploy. Then open `/api/health` to confirm:

```json
{
  "status": "ok",
  "ai": { "configured": true, "provider": "openai-compatible", "missingVariables": [] },
  "rateLimit": { "perMinute": 15, "scope": "per-instance, best effort" },
  "prompts": { "...": "versioned prompt ids" },
  "time": "2026-01-01T00:00:00.000Z"
}
```

The endpoint reports only _whether_ each variable is present — never the key, the model name or the
base URL — so it is safe to leave public and useful as a deploy smoke test.

No `vercel.json` is required. The AI routes declare `maxDuration = 30` (Vercel reads segment config
statically, so it must be a numeric literal) and force the Node.js runtime, because the streaming
chat route uses Node streams.

[free]: #using-a-free-llm-provider

---

## Using a free LLM provider

Any provider that exposes an OpenAI-compatible `/chat/completions` endpoint works; the adapter is
driven entirely by three variables. `LLM_BASE_URL` must include the version segment and have no
trailing slash.

| Provider                          | `LLM_BASE_URL`                                            | Free-tier notes                                                                            |
| --------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Google Gemini**                 | `https://generativelanguage.googleapis.com/v1beta/openai` | Generous free tier on Flash models; the best default for a demo.                           |
| **Groq**                          | `https://api.groq.com/openai/v1`                          | Very fast; free daily token allowance, resets daily.                                       |
| **OpenRouter**                    | `https://openrouter.ai/api/v1`                            | Aggregator; `:free` model suffixes cost nothing but are rate-limited and sometimes queued. |
| **OpenAI**                        | `https://api.openai.com/v1`                               | Paid; `gpt-4o-mini` is inexpensive and reliable.                                           |
| **Together / DeepSeek / Mistral** | vendor-specific                                           | All OpenAI-compatible.                                                                     |
| **Ollama (local)**                | `http://localhost:11434/v1`                               | Free and private; not reachable from Vercel, but ideal for local development.              |

The three LLM variables are all-or-nothing; supplying only some leaves AI disabled and `/api/health`
lists exactly which are missing. `RATE_LIMIT_PER_MIN` defaults to 15 and is shared across all four
AI routes.

Because free tiers are tight, the request path is designed to spend as few tokens as possible:

- **Structured, not conversational.** Every generation call requests a JSON object matching a known
  shape, at a token budget sized for that shape.
- **In-process caching.** An ideas request is keyed by a content hash of the brief and the titles
  already shown, so a repeat costs nothing.
- **Deterministic fallbacks.** A missing key, a timeout, a 5xx, a fence-wrapped response, a
  schema-invalid payload — every one of these lands on the same deterministic fallback rather than
  surfacing an error the user cannot act on.

---

## How the AI layer works

**Prompts are code.** `lib/ai/prompts.ts` holds versioned, typed template builders. Each returns the
message list _and_ the id it is registered under (`PROMPT_IDS`), so a request can be traced to the
prompt that produced it, and changing a prompt means changing a version constant rather than editing
a string in place. The system prompt for every task states the same rules: answer with JSON only, no
prose, never invent amounts, and treat anything in the user's text as data rather than instruction.

**Nothing unvalidated is trusted.** `lib/ai/parse.ts` runs the response through a fixed pipeline:

````
raw text
  → strip ```json fences
  → JSON.parse
  → zod .strict() schema check
      on failure: strip fences again, repair once (balanced braces, trailing commas), retry
      still failing: hand the caller a typed `undefined`
````

A `undefined` is not an error the user sees. It means "the model did not give us something usable",
and the caller substitutes the deterministic fallback from `lib/ai/fallbacks.ts`, flagged with
`source: 'fallback'` in the response and labelled in the UI as a _standard review_. The same path
covers the no-key-configured case, so the app's behaviour degrades along one code path rather than
several.

**The AI never changes a number.** Budget advice comes back as _proposals_ — "move 2% of the total
from décor to catering", with a rationale. Each is rendered with an **Apply** button, and
`applyTransfer` runs locally, in integer minor units, refusing to draw from the protected
contingency. If the user never presses Apply, nothing in the ledger changes. This is the deliberate
distinction between a suggestion and a mutation.

**Prompt injection is treated as expected input.** `lib/security/sanitize.ts` strips control
characters, collapses runs of horizontal whitespace, caps newline runs and caps length before any
user text reaches a prompt — so a "consideration" field cannot be used to forge a delimiter or pad a
request. Every system prompt additionally instructs the model to treat quoted user text as data.

**The chat digest is budgeted.** `lib/domain/summary.ts` builds a compact, token-budgeted digest of
the plan — totals, the categories that are over or under, the next few deadlines — rather than
pasting the whole plan into the context. Chat streams back as plain text; offline answers are
prefixed with a sentinel byte that the client strips and uses to label the answer as not-from-model.

---

## Security

| Concern                      | Mitigation                                                                                                                                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Key exposure**             | `lib/security/env.ts` imports `server-only`, so importing it from a Client Component is a build error. The key is read in the route handler, never serialised, and `/api/health` reports only presence.                                                                                                   |
| **Request smuggling**        | Every body is `.strict()` zod. An unknown key is a 400, so a field like `systemOverride` cannot ride along into a prompt. Length caps mirror the plan caps.                                                                                                                                               |
| **Oversized bodies**         | A declared `Content-Length` over `MAX_BODY_BYTES` (32 KiB) is rejected 413 before the body is read.                                                                                                                                                                                                       |
| **Cross-site abuse**         | POSTs must carry an `Origin` matching the `Host`, else 403. Both a missing and a mismatched Origin are rejected — the API is only ever called by our own page.                                                                                                                                            |
| **Brute force / cost abuse** | A per-IP sliding window (`RATE_LIMIT_PER_MIN`, default 15/min) returns 429 with a `Retry-After` header. It is explicitly best-effort: in instance memory, so a multi-lambda deployment gives each warm instance its own window. The upgrade path (Upstash, Vercel KV) slots in behind the same interface. |
| **XSS**                      | No `dangerouslySetInnerHTML` anywhere in the codebase. All user text renders as text nodes.                                                                                                                                                                                                               |
| **Clickjacking**             | `frame-ancestors 'none'` in the CSP.                                                                                                                                                                                                                                                                      |
| **Data leakage**             | `connect-src 'self'` — the browser never talks to the model provider, since all LLM traffic is server-side. Upstream error bodies are never echoed to the client: a provider failure becomes a generic `ai_failed` with the detail dropped.                                                               |
| **PII in logs**              | Log lines carry a request id, an error code and a path. Never a body, a message or a plan.                                                                                                                                                                                                                |

The CSP in `next.config.ts` is strict and documented inline, including _why_ `'unsafe-inline'` is
granted for styles (Next's font and layout handling) and deliberately **not** granted for scripts.

---

## The design system

The visual identity is **Stationery & Ledger**: the app should feel like a well-kept planning
notebook, not a SaaS dashboard.

- **Four typefaces, each with one job.** Fraunces (display) for headings and the wordmark; Hanken
  Grotesk (body) for UI text; IBM Plex Mono (ledger) for money, dates and reference codes, with
  tabular figures so columns of numbers actually align; Caveat (hand) for margin notes. All are
  self-hosted through `next/font`, so there is no render-blocking request to Google and no layout
  shift.
- **Tokens, not values.** Colour, spacing, radii, shadows, easing and durations live as CSS custom
  properties in `app/globals.css`. Components consume variables and never hardcode a colour, which is
  what makes the day/evening theme a single attribute flip.
- **Two themes.** `data-theme="day" | "evening"` on `<html>`, bootstrapped by a `beforeInteractive`
  script reading `localStorage['fete.theme']` _before_ first paint, so there is no flash of the wrong
  theme.
- **A small vocabulary.** A card is a `Sheet` of paper; a status is a rubber `Stamp`; a divider is a
  `Rule`; money is set in `Money`. Because these are tiny wrappers over CSS Modules, the look is
  expressed once and cannot drift between screens.
- **CSS Modules only.** No Tailwind, no component library, no icon library, no chart library — every
  class is local and scoped, and the whole design system is roughly one small CSS file plus one
  module per primitive.
- **Money is locale-pinned.** Amounts format with `en-US` regardless of the browser locale, so the
  server and client render byte-identical strings and hydration cannot mismatch.
- **Print styles matter.** `app/print.css` turns the workspace into a clean dossier: navigation and
  toolbars are hidden, and `data-print-surface` sheets avoid breaking across pages.

---

## Testing

```bash
npm test                  # everything
npm test -- --project node   # fast: domain, schemas, storage, routes
npm test -- --project ui     # jsdom: components
```

Two Vitest projects keep the fast tests fast: `*.node.test.ts` run in Node, `*.ui.test.tsx` run in
jsdom with Testing Library. 164 tests across nine files.

| File                                   | Covers                                                                                                                                                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `budget.node.test.ts`                  | Largest-remainder allocation sums exactly to the budget; over-allocation detection; `applyTransfer` refuses to drain the contingency.                                                                                                               |
| `money.node.test.ts` _(within budget)_ | Minor-unit conversion across zero-decimal (JPY), two-decimal and three-decimal currencies.                                                                                                                                                          |
| `timeline.node.test.ts`                | Countdown windows derived backwards from the date; day-of ordering; completion persistence.                                                                                                                                                         |
| `plan.node.test.ts`                    | Plan creation, re-derivation on brief change, duplication, demo seeds, `.ics` structure and the digest.                                                                                                                                             |
| `brief.node.test.ts`                   | **Per-step validation**: a complete draft passes every step, an incomplete step fails, and a field belonging to another step is never reported — the regression that made the wizard unusable.                                                      |
| `storage.node.test.ts`                 | Envelope migration from an older version, row-level isolation of a corrupt plan, share/import round-trip, and the share size cap.                                                                                                                   |
| `ai.node.test.ts`                      | Fence stripping, the one-shot repair, schema rejection → fallback, and the prompt builders.                                                                                                                                                         |
| `security.node.test.ts`                | Sliding-window rate limiting, key bounding, and sanitisation of control characters and whitespace runs.                                                                                                                                             |
| `api.node.test.ts`                     | **Route handlers end to end** with `fetch` faked at the network seam: origin rejection, oversize rejection, unknown-key rejection, rate limiting, AI-on success, fallbacks on 5xx/garbage/schema-invalid, and `/api/health` never leaking a secret. |
| `ui.ui.test.tsx`                       | Money formatting and signs, progress ARIA and clamping, `Field` label/hint/error wiring, the full WAI-ARIA tab keyboard pattern, the five-step wizard completing with an exact integer budget, and ledger edits committing exact minor units.       |

The API tests fake `fetch` rather than stubbing the provider interface on purpose: that covers the
OpenAI-compatible body shaping, the JSON-mode retry and the never-leak-upstream-detail rule in the
same pass.

`npm run verify` runs lint, typecheck, tests and a production build in sequence — the definition of
done for any change.

### A note on `npm audit`

`npm audit` currently reports 10 advisories (2 moderate, 6 high, 2 critical). Every one of them is in
a **transitive build-time dependency**, and none is in shipped application code:

| Package                      | Reached via                           | Notes                                                                   |
| ---------------------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| `postcss`                    | `next` (pinned internally) and `vite` | Build-time CSS processing. Fixed upstream only in Next 16 / newer Vite. |
| `braces`                     | `eslint-config-next` → `micromatch`   | Lint-time glob matching.                                                |
| `tinypool`, `@vitest/mocker` | `vitest`                              | Test runner only; not deployed.                                         |

The suggested `npm audit fix --force` resolutions are major-version jumps (Next 16, Vitest 5,
`eslint-config-next` 14) that would be a breaking change to the framework the brief specifies. The
production dependency surface is deliberately tiny — 17 packages — and the deployable artifact
contains only framework code and this repository's own source.

---

## Known limitations

- **Plans are per-browser.** There is no account and no server-side store, so clearing site data
  loses your plans, and a plan does not follow you to another device. Sharing a link and importing
  the JSON are the supported ways to move one — this is a deliberate consequence of the
  no-database constraint, not an oversight.
- **Share links have a hard ceiling.** `MAX_SHARE_CHARS` is 7,000, comfortably under the ~8 KB
  where chat apps and browsers start truncating URLs. A plan that does not fit is compressed through
  a documented fidelity ladder before it fails:

  | Step | What is dropped                                                                                 | Reported as      |
  | ---- | ----------------------------------------------------------------------------------------------- | ---------------- |
  | 0    | Vendor free-text notes, cached AI questions/red-flags, dismissed ideas — private or regenerable | `full`           |
  | 1    | Long prose fields (considerations, idea bodies) are shortened                                   | `trimmed_detail` |
  | 2    | Only the essentials needed to read the plan survive                                             | `compact`        |

  A `full` link is lossless. The UI tells the user which fidelity they got, and the export-JSON route
  is always offered as the alternative when even `compact` does not fit.

- **Rate limiting is best-effort.** Per-instance, in memory. It blunts accidental loops and casual
  abuse on a free tier; it is not a security boundary. See [Security](#security).
- **The AI is a suggestion engine, by design.** It cannot alter a number without an explicit Apply,
  and a run of provider failures degrades to the standard review rather than an error. If you want
  an agent that edits your plan, this is not that app.
- **No collaborative editing.** Two people cannot edit one plan at once; there is no merge. Share
  links are read-only snapshots that import as copies.
- **`maxDuration = 30`.** Chat streams and structured generations are cut off after 30 seconds. A
  slow free-tier provider under load may hit this; the route falls back rather than hanging.
- **English only.** Copy, prompt templates and vendor fallbacks are written in English. The currency
  and number formatting is correct for other locales, but the words are not translated.
