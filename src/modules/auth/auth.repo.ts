import { prisma } from '@/shared/db/prisma'
import { textContains } from '@/shared/db/text-search'
import { TIE_BREAKER, toSkipTake } from '@/shared/http/pagination'
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

/** Профиль для шапки и личного кабинета: то, чего нет в объекте текущего пользователя. */
export async function findProfile(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { position: true, university: { select: { name: true } } },
  })
}

export async function findMany(query: UserListQuery): Promise<{ rows: UserRow[]; total: number }> {
  const where: Prisma.UserWhereInput = {}

  if (query.role?.length) where.role = { in: query.role }
  if (query.universityId) where.universityId = query.universityId
  if (!query.includeInactive) where.isActive = true
  if (query.q) {
    const contains = textContains(query.q)
    where.OR = [{ fullName: contains }, { email: contains }, { position: contains }]
  }

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }, TIE_BREAKER],
      ...toSkipTake({ page: query.page, pageSize: query.pageSize }),
    }),
    prisma.user.count({ where }),
  ])
  return { rows, total }
}
