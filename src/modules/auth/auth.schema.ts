import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import { USER_ROLES } from '@/shared/contracts/enums'

const multi = <S extends z.ZodType>(schema: S) =>
  z.union([schema, z.array(schema)]).transform((value) => (Array.isArray(value) ? value : [value]))

export const userListQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  role: multi(z.enum(USER_ROLES)).optional(),
  universityId: z.string().trim().min(1).optional(),
  includeInactive: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
})

export type UserListQuery = z.infer<typeof userListQuerySchema>
