import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import { COOPERATION_STATUSES, OPEN_COOPERATION_STATUSES } from '@/shared/contracts/enums'

const multi = <S extends z.ZodType>(schema: S) =>
  z.union([schema, z.array(schema)]).transform((value) => (Array.isArray(value) ? value : [value]))

export const COOPERATION_SORT_FIELDS = [
  'status',
  'createdAt',
  'updatedAt',
  'targetDate',
  'classesStartAt',
] as const

export const cooperationListQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  universityId: z.string().trim().min(1).optional(),
  programId: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).optional(),
  responsibleId: z.string().trim().min(1).optional(),
  status: multi(z.enum(COOPERATION_STATUSES)).optional(),
  /** Только связки с просроченными этапами. */
  onlyOverdue: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
  /** Только связки с заблокированными этапами. */
  onlyBlocked: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
  sort: z.string().optional(),
})

export type CooperationListQuery = z.infer<typeof cooperationListQuerySchema>

const isoDate = z.iso.datetime({ message: 'Дата должна быть в формате ISO 8601' })

/** База без значений по умолчанию: `.partial()` их не снимает (см. схему вузов). */
const cooperationFields = {
  /** Продукт может быть не выбран на ранних этапах (решение 1). */
  productId: z.string().trim().min(1).nullish(),
  responsibleId: z.string().trim().min(1, 'Укажите ответственного'),
  status: z.enum(COOPERATION_STATUSES),
  goal: z.string().trim().max(1000).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  firstContactAt: isoDate.nullish(),
  classesStartAt: isoDate.nullish(),
  targetDate: isoDate.nullish(),
}

export const createCooperationSchema = z.object({
  universityId: z.string().trim().min(1, 'Укажите вуз'),
  programId: z.string().trim().min(1, 'Укажите образовательную программу'),
  ...cooperationFields,
  /**
   * Новая связка — открытая. Созданная сразу «завершённой» получала четырнадцать
   * нетронутых этапов и пустую дату закрытия: дату ставит только закрытие
   * существующей связки.
   */
  status: z
    .enum(OPEN_COOPERATION_STATUSES, {
      error: 'Новая связка создаётся открытой: черновик, в работе или на паузе',
    })
    .default('DRAFT'),
})

export type CreateCooperationInput = z.infer<typeof createCooperationSchema>

export const updateCooperationSchema = z
  .object(cooperationFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Не передано ни одного поля для изменения',
  })

export type UpdateCooperationInput = z.infer<typeof updateCooperationSchema>
