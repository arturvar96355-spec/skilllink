import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import {
  RECOMMENDATION_PRIORITIES,
  RECOMMENDATION_STATUSES,
  RECOMMENDATION_TYPES,
} from '@/shared/contracts/enums'

const multi = <S extends z.ZodType>(schema: S) =>
  z.union([schema, z.array(schema)]).transform((value) => (Array.isArray(value) ? value : [value]))

/** `score` — балл рекомендации (решение 119); `-score` — сначала самые полезные. */
export const RECOMMENDATION_SORT_FIELDS = ['priority', 'createdAt', 'updatedAt', 'score'] as const

export const recommendationListQuerySchema = paginationSchema.extend({
  type: multi(z.enum(RECOMMENDATION_TYPES)).optional(),
  status: multi(z.enum(RECOMMENDATION_STATUSES)).optional(),
  priority: multi(z.enum(RECOMMENDATION_PRIORITIES)).optional(),
  cooperationId: z.string().trim().min(1).optional(),
  /** Фильтр раздела рекомендаций по региону вуза (пункт 7.5 ТЗ). */
  region: z.string().trim().min(1).max(120).optional(),
  /** Решение 119: `false` — без отложенных защитой от перегрузки, `true` — только они. */
  deferred: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
  sort: z.string().optional(),
})

export type RecommendationListQuery = z.infer<typeof recommendationListQuerySchema>

/**
 * Сотрудник принимает, откладывает или отклоняет рекомендацию.
 * Отклонение требует комментария: без основания журнал бесполезен.
 */
export const updateRecommendationSchema = z
  .object({
    status: z.enum(RECOMMENDATION_STATUSES),
    comment: z.string().trim().max(1000).nullish(),
  })
  .refine((value) => value.status !== 'DISMISSED' || (value.comment ?? '').trim().length > 0, {
    message: 'Для отклонения рекомендации нужен комментарий с основанием',
    path: ['comment'],
  })

export type UpdateRecommendationInput = z.infer<typeof updateRecommendationSchema>

/**
 * «Почему нет рекомендации» (решение 119): объект, по которому прогнать правила.
 * `rule` — одно правило; без него — все правила этого вида объекта.
 */
export const WHY_NOT_ENTITIES = ['program', 'cooperation', 'skill'] as const

export const whyNotQuerySchema = z.object({
  entity: z.enum(WHY_NOT_ENTITIES),
  id: z.string().trim().min(1).max(64),
  rule: z.string().trim().min(1).max(80).optional(),
})

export type WhyNotQuery = z.infer<typeof whyNotQuerySchema>
