import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'

export const dataSourceListQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
})

export type DataSourceListQuery = z.infer<typeof dataSourceListQuerySchema>

export const syncMarketDataSchema = z.object({
  /** Период вида 2026-Q1 или 2026-03. Без него берётся период по умолчанию источника. */
  period: z
    .string()
    .trim()
    .regex(/^\d{4}-(Q[1-4]|(0[1-9]|1[0-2]))$/, 'Период должен быть в формате 2026-Q1 или 2026-03')
    .optional(),
})

export type SyncMarketDataInput = z.infer<typeof syncMarketDataSchema>
