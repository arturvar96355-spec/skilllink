import { z } from '@/shared/zod'
import { AI_PROPOSAL_KINDS } from '@/shared/contracts/ai-story'

/**
 * Тело «Предложить план» (решение 138). Вид проекта необязателен: не передан —
 * сервис сам решает по препятствиям связки (`chooseProposalKind`, ai-story.service.ts).
 */
export const createProposalSchema = z.object({
  kind: z.enum(AI_PROPOSAL_KINDS).nullish(),
})

export type CreateProposalInput = z.infer<typeof createProposalSchema>
