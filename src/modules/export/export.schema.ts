import { z } from '@/shared/zod'
import { parseQuery } from '@/shared/http/request'
import {
  cooperationListQuerySchema,
  type CooperationListQuery,
} from '@/modules/cooperation/cooperation.schema'
import { programListQuerySchema, type ProgramListQuery } from '@/modules/programs/programs.schema'
import {
  universityListQuerySchema,
  type UniversityListQuery,
} from '@/modules/universities/universities.schema'

export const EXPORT_DATASETS = ['universities', 'programs', 'cooperations', 'skill-gaps'] as const

export const exportQuerySchema = z.object({
  dataset: z.enum(EXPORT_DATASETS),
  /** Ограничение выгрузки: защищает от случайной выгрузки всей базы одним запросом. */
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
  universityId: z.string().trim().min(1).optional(),
})

export type ExportQuery = z.infer<typeof exportQuerySchema>

/**
 * Что выгружать: раздел, предел строк и фильтры его списка.
 *
 * Фильтры — те же параметры и та же схема, что у `GET /api/<раздел>`: кнопка
 * «Выгрузить» передаёт то, что стоит на экране, и в файл попадают ровно
 * отобранные строки: человек, отобравший заблокированные связки, получает
 * в файле только их, а не все.
 */
export type ExportRequest =
  | { dataset: 'universities'; limit: number; filters: UniversityListQuery }
  | { dataset: 'programs'; limit: number; filters: ProgramListQuery }
  | { dataset: 'cooperations'; limit: number; filters: CooperationListQuery }
  | { dataset: 'skill-gaps'; limit: number; universityId?: string }

export function parseExportRequest(request: Request): ExportRequest {
  const { dataset, limit, universityId } = parseQuery(request, exportQuerySchema)
  switch (dataset) {
    case 'universities':
      return { dataset, limit, filters: parseQuery(request, universityListQuerySchema) }
    case 'programs':
      return { dataset, limit, filters: parseQuery(request, programListQuerySchema) }
    case 'cooperations':
      return { dataset, limit, filters: parseQuery(request, cooperationListQuerySchema) }
    case 'skill-gaps':
      return { dataset, limit, ...(universityId ? { universityId } : {}) }
  }
}
