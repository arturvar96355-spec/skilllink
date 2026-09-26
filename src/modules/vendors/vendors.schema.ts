import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'

export const vendorListQuerySchema = paginationSchema.extend({
  /** Поиск по названию вендора или его продукта. */
  q: z.string().trim().min(1).max(200).optional(),
})

export type VendorListQuery = z.infer<typeof vendorListQuerySchema>

/** Загрузка вендоров: по умолчанию предпросмотр, запись — только `mode=apply`. */
export const vendorImportQuerySchema = z.object({
  mode: z.enum(['preview', 'apply']).default('preview'),
})

export type VendorImportQuery = z.infer<typeof vendorImportQuerySchema>
