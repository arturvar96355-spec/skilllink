import { z } from '@/shared/zod'

export const EXPORT_DATASETS = ['universities', 'programs', 'cooperations', 'skill-gaps'] as const
export type ExportDataset = (typeof EXPORT_DATASETS)[number]

export const exportQuerySchema = z.object({
  dataset: z.enum(EXPORT_DATASETS),
  /** Ограничение выгрузки: защищает от случайной выгрузки всей базы одним запросом. */
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
  universityId: z.string().trim().min(1).optional(),
})

export type ExportQuery = z.infer<typeof exportQuerySchema>
