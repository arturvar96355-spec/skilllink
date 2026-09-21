import { prisma } from '@/shared/db/prisma'
import { toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import type { UserListQuery } from './auth.schema'

const userSelect = {
  id: true,
  email: true,
  fullName: true,
  position: true,
  role: true,
  universityId: true,
  isActive: true,
  university: { select: { name: true } },
} satisfies Prisma.UserSelect

export type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>

export async function findMany(query: UserListQuery): Promise<{ rows: UserRow[]; total: number }> {
  const where: Prisma.UserWhereInput = {}

  if (query.role?.length) where.role = { in: query.role }
  if (query.universityId) where.universityId = query.universityId
  if (!query.includeInactive) where.isActive = true
  if (query.q) {
    const contains = { contains: query.q, mode: 'insensitive' as const }
    where.OR = [{ fullName: contains }, { email: contains }, { position: contains }]
  }

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
      ...toSkipTake({ page: query.page, pageSize: query.pageSize }),
    }),
    prisma.user.count({ where }),
  ])
  return { rows, total }
}
