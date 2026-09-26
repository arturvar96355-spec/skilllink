import { CONTACT_REVEAL } from '@/shared/config/contacts.config'
import { countSchema, webUrlSchema, z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import { legalEntityInnSchema, legalEntityOgrnSchema } from '@/shared/validation/inn-ogrn'
import { CONSENT_FORMS, CONTACT_LEGAL_BASES, UNIVERSITY_STATUSES } from '@/shared/contracts/enums'

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
   * Рейтинг вуза возвращается **по умолчанию** (docs/DECISIONS.md, пункт 11).
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
  /** ИНН и ОГРН организации (решение 134): контрольная цифра проверяется здесь, формат — ещё и CHECK базы. */
  inn: legalEntityInnSchema.nullish(),
  ogrn: legalEntityOgrnSchema.nullish(),
}

/** Схемы полей вуза — для значений, которые администратор задаёт вручную при слиянии. */
export const universityFieldSchemas = universityFields

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

// ───────────── Правовое основание обработки ПД и согласие (решение 111) ─────────────

const isoDate = z.iso.datetime({ message: 'Дата должна быть в формате ISO 8601' })

/**
 * Где лежит документ: номер, дата, место хранения («Соглашение № 12/2026 от 01.09.2026,
 * папка «Договоры с вузами»»). Не файл и не персональные данные — ФИО сюда не пишут.
 */
const documentReferenceSchema = (message: string) =>
  z.string().trim().min(3, message).max(200, 'Не длиннее 200 символов')

/**
 * Зафиксировать основание обработки ПД контакта. Согласованность полей (дата и форма
 * только при согласии, дата не в будущем) проверяют правила модуля: там же текущее
 * состояние контакта и время.
 */
export const setContactBasisSchema = z.object({
  basis: z.enum(CONTACT_LEGAL_BASES),
  documentReference: documentReferenceSchema(
    'Укажите документ-основание: номер, дату и где он хранится',
  ),
  consentObtainedAt: isoDate.nullish(),
  consentForm: z.enum(CONSENT_FORMS).nullish(),
  /** Решение 123: редакция политики обработки ПД; не передана — действующая. */
  policyVersion: z.string().trim().min(1).max(50).nullish(),
  /**
   * Решение 123: текст подписанного бланка согласия. Хранится только его SHA-256;
   * не передан — хешируется бланк по умолчанию (consent.config.ts).
   */
  consentText: z.string().trim().min(1).max(20_000).nullish(),
  /** Решение 123: где получено согласие («встреча в вузе 12.09», «при подписании соглашения»). Без ФИО. */
  consentContext: z.string().trim().min(1).max(200).nullish(),
})

export type SetContactBasisBody = z.infer<typeof setContactBasisSchema>

/** Отзыв согласия. Дата — когда получен отзыв (по умолчанию сейчас); документ обязателен. */
export const withdrawConsentSchema = z.object({
  withdrawnAt: isoDate.optional(),
  withdrawalReference: documentReferenceSchema(
    'Укажите документ отзыва: входящий номер, дату и где он хранится',
  ),
})

export type WithdrawConsentBody = z.infer<typeof withdrawConsentSchema>

export const contactBasisHistoryQuerySchema = paginationSchema

/** POST /api/contacts/:id/reveal (решение 133): какие поля и зачем. */
export const revealContactSchema = z.object({
  /** Какие поля раскрыть; не передано — оба. */
  fields: z.array(z.enum(['email', 'phone'])).min(1).max(2).optional(),
  reason: z
    .string()
    .trim()
    .min(CONTACT_REVEAL.reasonMinLength, `Опишите причину — не короче ${CONTACT_REVEAL.reasonMinLength} символов`)
    .max(CONTACT_REVEAL.reasonMaxLength),
})
export type RevealContactBody = z.infer<typeof revealContactSchema>
