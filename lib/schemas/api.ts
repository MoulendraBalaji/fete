/**
 * Request/response contracts for the AI routes. `.strict()` rejects unknown
 * keys outright, and every field mirrors the shared brief/plan caps so a
 * malicious or bloated body dies at the edge of the handler.
 */
import { z } from 'zod';
import { briefSchema } from './brief';
import {
  boundedText,
  categoryKeySchema,
  costTierSchema,
  ideaKindSchema,
  TEXT_LIMITS,
} from './core';
import { budgetRowSchema } from './plan';

/** Raw request bodies (validated before anything touches the LLM). */

export const ideasRequestSchema = z.object({ brief: briefSchema }).strict();

export const vendorTipsRequestSchema = z
  .object({ brief: briefSchema, categoryKey: categoryKeySchema })
  .strict();

export const budgetAdviceRequestSchema = z
  .object({
    brief: briefSchema,
    rows: z.array(budgetRowSchema).min(1).max(20),
  })
  .strict();

export const chatRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(TEXT_LIMITS.chatMessage),
    /** Token-budgeted plan digest built client-side by lib/domain/summary.ts. */
    context: z.string().trim().max(TEXT_LIMITS.chatContext),
  })
  .strict();

/** Structured outputs the model must conform to (validated after parsing). */

export const aiIdeaSchema = z
  .object({
    kind: ideaKindSchema,
    title: boundedText(TEXT_LIMITS.short, 'title'),
    body: boundedText(TEXT_LIMITS.long, 'body'),
    costTier: costTierSchema,
  })
  .strict();

export const aiIdeasResponseSchema = z
  .object({ ideas: z.array(aiIdeaSchema).min(1).max(8) })
  .strict();

export const aiVendorTipsSchema = z
  .object({
    questions: z.array(boundedText(TEXT_LIMITS.medium, 'question')).min(2).max(6),
    redFlags: z.array(boundedText(TEXT_LIMITS.medium, 'red flag')).min(1).max(5),
  })
  .strict();

/** A transfer is expressed as a share of the total so the model never does money math. */
export const budgetTransferSchema = z
  .object({
    from: categoryKeySchema,
    to: categoryKeySchema,
    percentOfTotal: z.number().int().min(1).max(40),
    rationale: boundedText(TEXT_LIMITS.medium, 'Rationale'),
  })
  .strict();

export const aiBudgetAdviceSchema = z
  .object({
    headline: boundedText(TEXT_LIMITS.medium, 'Headline'),
    tradeoffs: z.array(boundedText(TEXT_LIMITS.long, 'Trade-off')).max(3),
    suggestions: z.array(budgetTransferSchema).max(4),
  })
  .strict();

/** Standard error envelope returned by every route. */
export const apiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.enum([
          'bad_request',
          'payload_too_large',
          'rate_limited',
          'origin_rejected',
          'ai_unavailable',
          'ai_failed',
          'not_found',
          'internal',
        ]),
        message: z.string().max(300),
        requestId: z.string().max(64).optional(),
      })
      .strict(),
  })
  .strict();

export type IdeasRequest = z.infer<typeof ideasRequestSchema>;
export type VendorTipsRequest = z.infer<typeof vendorTipsRequestSchema>;
export type BudgetAdviceRequest = z.infer<typeof budgetAdviceRequestSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type AiIdea = z.infer<typeof aiIdeaSchema>;
export type AiIdeasResponse = z.infer<typeof aiIdeasResponseSchema>;
export type AiVendorTips = z.infer<typeof aiVendorTipsSchema>;
export type AiBudgetAdvice = z.infer<typeof aiBudgetAdviceSchema>;
export type BudgetTransfer = z.infer<typeof budgetTransferSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
