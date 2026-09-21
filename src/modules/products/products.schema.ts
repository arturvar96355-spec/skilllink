import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import { PRODUCT_STATUSES } from '@/shared/contracts/enums'

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

export type ReleasePreviewQuery = z.infer<typeof releasePreviewQuerySchema>
