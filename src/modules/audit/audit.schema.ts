import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'

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
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type UniversityEventsQuery = z.infer<typeof universityEventsQuerySchema>
