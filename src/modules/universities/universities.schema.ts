import { z } from '@/shared/zod'
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

export const universityListQuerySchema = paginationSchema.extend({
  /** Поиск по названию, краткому названию, городу, региону и названиям программ. */
  q: z.string().trim().min(1).max(200).optional(),
  status: multiStatusSchema.optional(),
  region: multiStringSchema.optional(),
  city: multiStringSchema.optional(),
  /** `name` или `-updatedAt`: минус означает убывание. */
  sort: z.string().optional(),
  /** По умолчанию архивные записи в списке не показываются. */
  includeArchived: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
})

export type UniversityListQuery = z.infer<typeof universityListQuerySchema>

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
  website: z.url('Некорректный адрес сайта').nullish(),
  status: statusSchema,
  directionCount: z.number().int().min(0).nullish(),
  studentCount: z.number().int().min(0).nullish(),
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
