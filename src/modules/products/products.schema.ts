import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import { PRODUCT_SKILL_RELEVANCE, PRODUCT_STATUSES } from '@/shared/contracts/enums'

const multi = <S extends z.ZodType>(schema: S) =>
  z.union([schema, z.array(schema)]).transform((value) => (Array.isArray(value) ? value : [value]))

export const PRODUCT_SORT_FIELDS = ['name', 'category', 'status', 'updatedAt'] as const

export const productListQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  category: multi(z.string().trim().min(1)).optional(),
  status: multi(z.enum(PRODUCT_STATUSES)).optional(),
  skillId: multi(z.string().trim().min(1)).optional(),
  sort: z.string().optional(),
})

export type ProductListQuery = z.infer<typeof productListQuerySchema>

/**
 * Выпуск новой версии продукта — групповая операция из концепции:
 * одно действие ставит задачи во всех связках, где передана устаревшая версия.
 */
export const releaseProductVersionSchema = z.object({
  version: z.string().trim().min(1, 'Укажите версию продукта').max(50),
  /** Пояснение попадёт в историю затронутых этапов. */
  comment: z.string().trim().max(500).nullish(),
})

export type ReleaseProductVersionInput = z.infer<typeof releaseProductVersionSchema>

export const releasePreviewQuerySchema = z.object({
  version: z.string().trim().min(1).max(50),
})

/**
 * Ссылка на документацию — только http(s).
 *
 * Карточка продукта выводит её обычной ссылкой (`<a href>`): `javascript:` или
 * `data:` в ней выполнились бы в браузере сотрудника по щелчку. Проверка схемы
 * `z.url()` такие адреса пропускает — протокол ограничивается явно.
 */
export const documentationUrlSchema = z
  .string()
  .trim()
  .max(500)
  .pipe(
    z.url({
      protocol: /^https?$/,
      error: 'Укажите адрес документации, начинающийся с http:// или https://',
    }),
  )

/** База без значений по умолчанию: `.partial()` их не снимает (см. схему вузов). */
const productFields = {
  name: z.string().trim().min(2, 'Название должно содержать не менее 2 символов').max(200),
  category: z.string().trim().min(2, 'Укажите категорию продукта').max(100),
  description: z.string().trim().max(2000).nullish(),
  documentationUrl: documentationUrlSchema.nullish(),
  version: z.string().trim().min(1, 'Версия не может быть пустой').max(50).nullish(),
  status: z.enum(PRODUCT_STATUSES),
}

export const createProductSchema = z.object({
  ...productFields,
  status: productFields.status.default('ACTIVE'),
})

export type CreateProductInput = z.infer<typeof createProductSchema>

export const updateProductSchema = z
  .object(productFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Не передано ни одного поля для изменения',
  })

export type UpdateProductInput = z.infer<typeof updateProductSchema>

export const productSkillInputSchema = z.object({
  skillId: z.string().trim().min(1, 'Укажите навык'),
  relevance: z.enum(PRODUCT_SKILL_RELEVANCE).default('RELATED'),
})

/** Полная замена набора навыков продукта — как у программ. */
export const setProductSkillsSchema = z.object({
  skills: z.array(productSkillInputSchema).max(100),
})

export type SetProductSkillsInput = z.infer<typeof setProductSkillsSchema>
