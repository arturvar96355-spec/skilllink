import { prisma } from '@/shared/db/prisma'
import { textContains } from '@/shared/db/text-search'
import { TIE_BREAKER, toSkipTake } from '@/shared/http/pagination'
import { OPEN_COOPERATION_STATUSES, type UserRole } from '@/shared/contracts/enums'
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

export async function findMany(
  query: UserListQuery,
  options: { searchEmail: boolean },
): Promise<{ rows: UserRow[]; total: number }> {
  const where: Prisma.UserWhereInput = {}

  if (query.role?.length) where.role = { in: query.role }
  if (query.universityId) where.universityId = query.universityId
  // Явный фильтр активности важнее `includeInactive`: вкладка «Пользователи»
  // показывает отдельно заблокированных.
  if (query.isActive !== undefined) where.isActive = query.isActive
  else if (!query.includeInactive) where.isActive = true
  if (query.q) {
    const contains = textContains(query.q)
    where.OR = [
      { fullName: contains },
      ...(options.searchEmail ? [{ email: contains }] : []),
      { position: contains },
    ]
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

// ── Управление пользователями ───────────────────────────────────────────────

export async function findById(id: string): Promise<(UserRow & { createdAt: Date }) | null> {
  return prisma.user.findUnique({ where: { id }, select: { ...userSelect, createdAt: true } })
}

export async function findByEmail(email: string): Promise<{ id: string } | null> {
  return prisma.user.findUnique({ where: { email }, select: { id: true } })
}

/** Вуз представителя: существует ли и не в архиве ли. */
export async function findUniversity(id: string) {
  return prisma.university.findUnique({ where: { id }, select: { id: true, archivedAt: true } })
}

/**
 * Открытая работа человека: связки (черновик, в работе, на паузе) и незакрытые
 * этапы открытых связок, где он ответственный.
 */
export async function countOpenWork(
  userId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ cooperations: number; stages: number }> {
  const openCooperation = { status: { in: [...OPEN_COOPERATION_STATUSES] } }
  // По очереди, а не Promise.all: внутри транзакции запросы и так идут
  // по одному соединению.
  const cooperations = await client.cooperation.count({
    where: { responsibleId: userId, ...openCooperation },
  })
  const stages = await client.workflowStage.count({
    where: {
      responsibleId: userId,
      status: { in: ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED'] },
      cooperation: openCooperation,
    },
  })
  return { cooperations, stages }
}

export async function createUser(data: {
  email: string
  fullName: string
  position: string | null
  role: UserRole
  universityId: string | null
  passwordHash: string
}): Promise<UserRow> {
  return prisma.user.create({ data, select: userSelect })
}

/**
 * Изменение пользователя в транзакции с проверкой.
 *
 * Строки действующих администраторов и самого изменяемого блокируются
 * до конца транзакции (`FOR UPDATE`). Без этого два администратора, одновременно
 * заблокировавшие друг друга, оба видели бы «есть ещё один» — и система осталась
 * бы без администратора. Второй запрос ждёт первого и пересчитывает уже
 * по записанному.
 */
export async function updateWithGuard(
  id: string,
  guard: (facts: {
    target: UserRow
    otherActiveAdmins: number
    openWork: { cooperations: number; stages: number }
  }) => Prisma.UserUpdateInput,
): Promise<{ before: UserRow; after: UserRow } | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} OR (role = 'ADMIN' AND is_active) FOR UPDATE`

    const target = await tx.user.findUnique({ where: { id }, select: userSelect })
    if (!target) return null

    const otherActiveAdmins = await tx.user.count({
      where: { role: 'ADMIN', isActive: true, id: { not: id } },
    })
    const openWork = await countOpenWork(id, tx)

    const data = guard({ target, otherActiveAdmins, openWork })
    const after = await tx.user.update({ where: { id }, data, select: userSelect })
    return { before: target, after }
  })
}

/** Хеш пароля — только для проверки текущего пароля. Наружу не отдаётся. */
export async function findPasswordHash(id: string): Promise<string | null> {
  const row = await prisma.user.findUnique({ where: { id }, select: { passwordHash: true } })
  return row?.passwordHash ?? null
}

export async function setPasswordHash(id: string, passwordHash: string): Promise<UserRow | null> {
  const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return null
  return prisma.user.update({ where: { id }, data: { passwordHash }, select: userSelect })
}

/** События пароля в журнале: по последнему из них видно, временный ли пароль сейчас. */
export const PASSWORD_EVENTS = ['user.create', 'user.password.reset', 'user.password.change'] as const

export async function findLastPasswordEvent(userId: string): Promise<string | null> {
  const row = await prisma.auditLog.findFirst({
    where: { objectType: 'User', objectId: userId, action: { in: [...PASSWORD_EVENTS] } },
    orderBy: [{ createdAt: 'desc' }, TIE_BREAKER],
    select: { action: true },
  })
  return row?.action ?? null
}
