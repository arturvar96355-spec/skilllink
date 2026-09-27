import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import type { AssignmentStatus } from '@/shared/contracts/enums'
import { TIE_BREAKER, toSkipTake, type Pagination } from '@/shared/http/pagination'

/** Доступ к таблице поручений (решение 207). Prisma — только здесь. */

export const assignmentSelect = {
  id: true,
  assigneeId: true,
  authorId: true,
  text: true,
  universityId: true,
  cooperationId: true,
  dueAt: true,
  priority: true,
  status: true,
  doneAt: true,
  isMock: true,
  createdAt: true,
  updatedAt: true,
  assignee: { select: { id: true, fullName: true } },
  author: { select: { id: true, fullName: true } },
  university: { select: { id: true, name: true, shortName: true } },
  cooperation: {
    select: {
      id: true,
      program: { select: { name: true } },
      university: { select: { id: true, name: true, shortName: true } },
    },
  },
} satisfies Prisma.AssignmentSelect

export type AssignmentRow = Prisma.AssignmentGetPayload<{ select: typeof assignmentSelect }>

export interface AssignmentFilter {
  assigneeId?: string
  statuses?: readonly AssignmentStatus[]
  /** Только просроченные: открытые со сроком раньше этой даты (полночь UTC сегодняшней московской даты). */
  overdueBefore?: Date
}

function whereOf(filter: AssignmentFilter): Prisma.AssignmentWhereInput {
  const statuses = filter.overdueBefore
    ? (filter.statuses ?? ['NEW', 'IN_PROGRESS']).filter((status) => status !== 'DONE')
    : filter.statuses
  return {
    ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
    ...(statuses ? { status: { in: [...statuses] } } : {}),
    ...(filter.overdueBefore ? { dueAt: { lt: filter.overdueBefore } } : {}),
  }
}

/** Список: ближайший срок — первым; при равном сроке — важные, затем по времени создания. */
export async function findMany(filter: AssignmentFilter, pagination: Pagination) {
  const where = whereOf(filter)
  const [rows, total] = await Promise.all([
    prisma.assignment.findMany({
      where,
      select: assignmentSelect,
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }, TIE_BREAKER],
      ...toSkipTake(pagination),
    }),
    prisma.assignment.count({ where }),
  ])
  return { rows, total }
}

export async function findById(id: string) {
  return prisma.assignment.findUnique({ where: { id }, select: assignmentSelect })
}

export async function create(data: Prisma.AssignmentUncheckedCreateInput) {
  return prisma.assignment.create({ data, select: assignmentSelect })
}

export async function update(id: string, data: Prisma.AssignmentUncheckedUpdateInput) {
  return prisma.assignment.update({ where: { id }, data, select: assignmentSelect })
}

/**
 * Кому можно поручить: действующий сотрудник ИТ-Школы — не представитель вуза
 * и не учётка эксперта хакатона (тот же круг, что список «Команды»).
 */
export async function findAssignableUser(id: string) {
  return prisma.user.findFirst({
    where: { id, isActive: true, isReviewer: false, role: { not: 'UNIVERSITY_REP' } },
    select: { id: true, fullName: true },
  })
}

export async function findCooperationUniversity(id: string) {
  return prisma.cooperation.findUnique({ where: { id }, select: { id: true, universityId: true } })
}

export async function universityExists(id: string): Promise<boolean> {
  return (await prisma.university.count({ where: { id } })) > 0
}
