import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import { UNIVERSITY_EVENTS_MAX_LIMIT } from '@/shared/contracts/audit'

const isoDate = z.iso.datetime({ message: 'Дата должна быть в формате ISO 8601' })

export const auditListQuerySchema = paginationSchema.extend({
  action: z.string().trim().min(1).max(100).optional(),
  objectType: z.string().trim().min(1).max(100).optional(),
  objectId: z.string().trim().min(1).optional(),
  userId: z.string().trim().min(1).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
})

export type AuditListQuery = z.infer<typeof auditListQuerySchema>

export const universityEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(UNIVERSITY_EVENTS_MAX_LIMIT).default(20),
})

export type UniversityEventsQuery = z.infer<typeof universityEventsQuerySchema>

/** Выгрузка журнала для внешней системы (решение 133): курсор и размер страницы. */
export const AUDIT_EXPORT_MAX_LIMIT = 5000

export const auditExportQuerySchema = z.object({
  after_id: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_EXPORT_MAX_LIMIT).default(1000),
})

export type AuditExportQuery = z.infer<typeof auditExportQuerySchema>
