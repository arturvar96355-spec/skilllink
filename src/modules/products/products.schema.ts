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
