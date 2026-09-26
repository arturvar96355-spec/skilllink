import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import {
  DSAR_REQUEST_KINDS,
  DSAR_REQUEST_STATUSES,
  DSAR_SUBJECT_TYPES,
} from '@/shared/contracts/dsar'

const booleanParam = z
  .union([z.literal('true'), z.literal('false')])
  .transform((value) => value === 'true')

/** Реестр запросов субъектов: по страницам, новые сверху. */
export const dsarRequestListQuerySchema = paginationSchema.extend({
  status: z.enum(DSAR_REQUEST_STATUSES).optional(),
  kind: z.enum(DSAR_REQUEST_KINDS).optional(),
  subjectType: z.enum(DSAR_SUBJECT_TYPES).optional(),
  subjectId: z.string().trim().min(1).max(64).optional(),
  /** Только открытые с прошедшим сроком. */
  overdue: booleanParam.optional(),
})

export type DsarRequestListQuery = z.infer<typeof dsarRequestListQuerySchema>

/**
 * Регистрация запроса, пришедшего письмом. Текст письма и ФИО сюда не пишутся:
 * субъект — идентификатор пользователя или контакта; письмо хранится у оператора.
 */
export const createDsarRequestSchema = z.object({
  subjectType: z.enum(DSAR_SUBJECT_TYPES),
  subjectId: z.string().trim().min(1).max(64),
  kind: z.enum(DSAR_REQUEST_KINDS),
  /**
   * Когда оператор получил запрос — от этой даты идёт срок (ч. 3 ст. 14). Не задана —
   * сейчас. Не в будущем и не старше 30 дней: запрос месячной давности уже просрочен.
   */
  receivedAt: z.iso.datetime({ message: 'Дата должна быть в формате ISO 8601' }).optional(),
})

export type CreateDsarRequestBody = z.infer<typeof createDsarRequestSchema>

/** Подтверждение обезличивания: логин пользователя или ФИО контакта, введённые вручную. */
export const eraseSubjectSchema = z.object({
  confirm: z.string().trim().min(1, 'Введите подтверждение').max(320, 'Слишком длинное подтверждение'),
})

export type EraseSubjectBody = z.infer<typeof eraseSubjectSchema>
