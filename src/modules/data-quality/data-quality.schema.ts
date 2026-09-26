import { z } from '@/shared/zod'
import { DUPLICATES } from '@/shared/config/data-quality.config'
import { DUPLICATE_ENTITY_TYPES } from '@/shared/contracts/data-quality'

const booleanFlag = z
  .union([z.literal('true'), z.literal('false')])
  .transform((value) => value === 'true')
  .optional()

export const duplicatesQuerySchema = z.object({
  entity: z.enum(DUPLICATE_ENTITY_TYPES, { message: 'Укажите сущность: university, skill, program или product' }),
  /** Порог сходства 0.1–1; по умолчанию — как у pg_trgm (0.4). */
  threshold: z.coerce.number().min(0.1, 'Порог не ниже 0.1').max(1, 'Порог не выше 1').default(DUPLICATES.trigramThreshold),
  /** Показать и пары, отмеченные «не дубль» (с признаком dismissed). */
  includeDismissed: booleanFlag,
  /** Сравнивать и архивные записи (вузы, программы). Слитые вузы не сравниваются никогда. */
  includeArchived: booleanFlag,
})

export type DuplicatesQuery = z.infer<typeof duplicatesQuerySchema>

export const dismissDuplicateSchema = z
  .object({
    entity: z.enum(DUPLICATE_ENTITY_TYPES),
    firstId: z.string().trim().min(1),
    secondId: z.string().trim().min(1),
    /** Почему не дубль — для того, кто увидит пару в следующий раз. */
    comment: z.string().trim().max(500).nullish(),
  })
  .refine((value) => value.firstId !== value.secondId, {
    message: 'Запись не может быть дублем самой себя',
    path: ['secondId'],
  })

export type DismissDuplicateInput = z.infer<typeof dismissDuplicateSchema>
