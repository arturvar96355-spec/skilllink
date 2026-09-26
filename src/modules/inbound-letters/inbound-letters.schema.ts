import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import { INBOUND_LETTER_GROUPS, INBOUND_LETTER_STATUSES, INBOUND_LETTER_VERDICTS } from '@/shared/contracts/enums'

const multi = <S extends z.ZodType>(schema: S) =>
  z.union([schema, z.array(schema)]).transform((value) => (Array.isArray(value) ? value : [value]))

export const INBOUND_LETTER_SORT_FIELDS = ['receivedAt', 'createdAt', 'status'] as const

export const inboundLetterListQuerySchema = paginationSchema.extend({
  status: multi(z.enum(INBOUND_LETTER_STATUSES)).optional(),
  group: multi(z.enum(INBOUND_LETTER_GROUPS)).optional(),
  universityId: z.string().trim().min(1).max(64).optional(),
  cooperationId: z.string().trim().min(1).max(64).optional(),
  sort: z.string().optional(),
})

export type InboundLetterListQuery = z.infer<typeof inboundLetterListQuerySchema>

/**
 * Проверка разбора: «Верно» — без дополнительных полей (разбор уже нашёл вуз);
 * «Неверно» — сотрудник указывает правильные вуз, связку (необязательно, не у
 * каждого письма есть подходящая), группу, действие и обязательный комментарий —
 * что было не так (тот же довод, что у отклонения рекомендации: без основания
 * журнал решений бесполезен).
 */
export const reviewLetterSchema = z
  .object({
    verdict: z.enum(INBOUND_LETTER_VERDICTS),
    universityId: z.string().trim().min(1).max(64).optional(),
    cooperationId: z.string().trim().min(1).max(64).optional(),
    group: z.enum(INBOUND_LETTER_GROUPS).optional(),
    action: z.string().trim().min(1).max(300).optional(),
    comment: z.string().trim().max(1000).optional(),
  })
  .refine((value) => value.verdict === 'CORRECT' || Boolean(value.universityId), {
    message: 'Для «Неверно» нужно указать вуз',
    path: ['universityId'],
  })
  .refine((value) => value.verdict === 'CORRECT' || Boolean(value.group), {
    message: 'Для «Неверно» нужно указать группу обращения',
    path: ['group'],
  })
  .refine((value) => value.verdict === 'CORRECT' || (value.action ?? '').trim().length > 0, {
    message: 'Для «Неверно» нужно указать действие ответственному',
    path: ['action'],
  })
  .refine((value) => value.verdict === 'CORRECT' || (value.comment ?? '').trim().length > 0, {
    message: 'Для «Неверно» нужен комментарий: что было не так в разборе',
    path: ['comment'],
  })

export type ReviewLetterInput = z.infer<typeof reviewLetterSchema>

export const dismissLetterSchema = z.object({
  comment: z.string().trim().max(1000).nullish(),
})

export type DismissLetterInput = z.infer<typeof dismissLetterSchema>

export const updateReplyDraftSchema = z.object({
  text: z.string().trim().min(1).max(4000),
})

export type UpdateReplyDraftInput = z.infer<typeof updateReplyDraftSchema>
