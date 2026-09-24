import { countSchema, webUrlSchema, z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import { UNIVERSITY_STATUSES } from '@/shared/contracts/enums'

const statusSchema = z.enum(UNIVERSITY_STATUSES)

/** Фильтр может прийти как ?status=ACTIVE или ?status=ACTIVE&status=NEW. */
const multiStatusSchema = z
  .union([statusSchema, z.array(statusSchema)])
  .transform((value) => (Array.isArray(value) ? value : [value]))

const multiStringSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]))

export const UNIVERSITY_SORT_FIELDS = [
  'name',
  'city',
  'region',
  'status',
  'createdAt',
  'updatedAt',
] as const

/**
 * Сортировка по рейтингу вынесена отдельно: рейтинг считается в приложении,
 * в базе его нет, поэтому SQL по нему не сортирует (пункт 7.2 ТЗ).
 */
export const UNIVERSITY_RATING_SORT = 'rating'

/** Числа из query приходят строками. */
const ratingBoundSchema = z.coerce
  .number()
  .min(0, 'Рейтинг не может быть меньше 0')
  .max(100, 'Рейтинг не может быть больше 100')

export const universityListQuerySchema = paginationSchema.extend({
  /** Поиск по названию, краткому названию, городу, региону и названиям программ. */
  q: z.string().trim().min(1).max(200).optional(),
  status: multiStatusSchema.optional(),
  region: multiStringSchema.optional(),
  city: multiStringSchema.optional(),
  /** `name`, `-updatedAt` или `-rating`: минус означает убывание. */
  sort: z.string().optional(),
  /** Нижняя граница рейтинга вуза, 0..100 (пункт 7.2 ТЗ). */
  minRating: ratingBoundSchema.optional(),
  /** Верхняя граница рейтинга вуза, 0..100. */
  maxRating: ratingBoundSchema.optional(),
  /**
   * Рейтинг вуза возвращается **по умолчанию** (решение Артура, пункт 11).
   *
   * `withRating=false` его отключает: это отдельный проход по показателям всех
   * программ, и там, где реестр нужен только для выбора из списка, платить
   * за него незачем. На тысяче вузов проход стоит около 17 мс.
   */
  withRating: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
  /** По умолчанию архивные записи в списке не показываются. */
  includeArchived: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
})

export type UniversityListQuery = z.infer<typeof universityListQuerySchema>

/**
 * Нужен ли этому запросу расчёт рейтингов.
 *
 * По умолчанию — да: рейтинг это обычное поле реестра. Отказаться можно только
 * явным `withRating=false`.
 */
export function needsRating(query: UniversityListQuery): boolean {
  return query.withRating !== false
}

/**
 * Запрошен ли рейтинг явно.
 *
 * Отличать важно для представителя вуза: рейтинг ему недоступен, но обычный
 * список он открывать вправе. Явный запрос — отказ, умолчание — просто `null`,
 * иначе роль не смогла бы открыть реестр вообще.
 */
export function ratingRequestedExplicitly(query: UniversityListQuery): boolean {
  return (
    query.withRating === true ||
    query.minRating !== undefined ||
    query.maxRating !== undefined ||
    query.sort?.replace(/^-/, '') === UNIVERSITY_RATING_SORT
  )
}

export const contactInputSchema = z.object({
  fullName: z.string().trim().min(2, 'Укажите ФИО контактного лица').max(200),
  position: z.string().trim().max(200).nullish(),
  email: z.email('Некорректный адрес электронной почты').nullish(),
  phone: z.string().trim().max(50).nullish(),
  isPrimary: z.boolean().optional(),
})

/**
 * Поля вуза без значений по умолчанию.
 * Отдельная база нужна потому, что `.partial()` не снимает `.default()`:
 * иначе пустой PATCH подставил бы статус NEW и молча изменил запись.
 */
const universityFields = {
  name: z.string().trim().min(3, 'Название должно содержать не менее 3 символов').max(300),
  shortName: z.string().trim().max(100).nullish(),
  city: z.string().trim().min(2, 'Укажите город').max(120),
  region: z.string().trim().min(2, 'Укажите регион').max(120),
  address: z.string().trim().max(300).nullish(),
  website: webUrlSchema('Некорректный адрес сайта: нужна ссылка http или https').nullish(),
  status: statusSchema,
  directionCount: countSchema().nullish(),
  studentCount: countSchema().nullish(),
  description: z.string().trim().max(2000).nullish(),
}

export const createUniversitySchema = z.object({
  ...universityFields,
  status: statusSchema.default('NEW'),
  contacts: z.array(contactInputSchema).max(20).optional(),
})

export type CreateUniversityInput = z.infer<typeof createUniversitySchema>

export const updateUniversitySchema = z
  .object(universityFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Не передано ни одного поля для изменения',
  })

export type UpdateUniversityInput = z.infer<typeof updateUniversitySchema>
