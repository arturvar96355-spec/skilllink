import { z } from '@/shared/zod'

/** Идентификатор сотрудника в адресе `GET /api/team/:userId` (решение 203). */
export const teamMemberParamsSchema = z.object({
  userId: z.string().trim().min(1).max(64),
})
