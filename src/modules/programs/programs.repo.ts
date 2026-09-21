import { prisma } from '@/shared/db/prisma'
import { buildOrderBy, parseSort, toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import { PROGRAM_SORT_FIELDS, type ProgramListQuery } from './programs.schema'

/** Показатели набора могут быть пустыми: «Нет данных» не должно всплывать наверх сортировки. */
const NULLABLE_SORT_FIELDS = ['applicationCount', 'studentCount', 'groupCount'] as const

const listSelect = {
  id: true,
  universityId: true,
  name: true,
  code: true,
  direction: true,
  level: true,
  durationMonths: true,
  status: true,
  applicationCount: true,
  studentCount: true,
  groupCount: true,
  metricsSource: true,
  metricsUpdatedAt: true,
  isMock: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  university: { select: { id: true, name: true } },
  _count: { select: { skills: true, cooperations: true } },
} satisfies Prisma.EducationalProgramSelect

const detailSelect = {
  ...listSelect,
  skills: {
    orderBy: [{ importance: 'desc' }, { skill: { name: 'asc' } }],
    select: {
      level: true,
      importance: true,
      source: true,
      confidence: true,
      comment: true,
      skill: { select: { id: true, name: true, category: true } },
    },
  },
} satisfies Prisma.EducationalProgramSelect

export type ProgramListRow = Prisma.EducationalProgramGetPayload<{ select: typeof listSelect }>
export type ProgramDetailRow = Prisma.EducationalProgramGetPayload<{ select: typeof detailSelect }>

export function buildWhere(
  query: ProgramListQuery,
  scope: { universityId?: string },
): Prisma.EducationalProgramWhereInput {
  const where: Prisma.EducationalProgramWhereInput = {}

  // Представитель вуза видит только свои программы (решение 10).
  if (scope.universityId) where.universityId = scope.universityId
  else if (query.universityId) where.universityId = query.universityId

  if (query.level?.length) where.level = { in: query.level }
  if (query.status?.length) where.status = { in: query.status }
  if (query.skillId?.length) where.skills = { some: { skillId: { in: query.skillId } } }
  if (!query.includeArchived) where.archivedAt = null

  if (query.q) {
    const contains = { contains: query.q, mode: 'insensitive' as const }
    where.OR = [
      { name: contains },
      { code: contains },
      { direction: contains },
      { university: { name: contains } },
    ]
  }

  return where
}

export async function findMany(
  query: ProgramListQuery,
  scope: { universityId?: string },
): Promise<{ rows: ProgramListRow[]; total: number }> {
  const where = buildWhere(query, scope)
  const { field, direction } = parseSort(query.sort, PROGRAM_SORT_FIELDS, {
    field: 'name',
    direction: 'asc',
  })

  const [rows, total] = await Promise.all([
    prisma.educationalProgram.findMany({
      where,
      select: listSelect,
      orderBy: buildOrderBy({ field, direction }, NULLABLE_SORT_FIELDS),
      ...toSkipTake({ page: query.page, pageSize: query.pageSize }),
    }),
    prisma.educationalProgram.count({ where }),
  ])

  return { rows, total }
}

export async function findById(
  id: string,
  scope: { universityId?: string },
): Promise<ProgramDetailRow | null> {
  return prisma.educationalProgram.findFirst({
    where: { id, ...(scope.universityId ? { universityId: scope.universityId } : {}) },
    select: detailSelect,
  })
}

export async function create(
  data: Prisma.EducationalProgramCreateInput,
): Promise<ProgramDetailRow> {
  return prisma.educationalProgram.create({ data, select: detailSelect })
}

export async function update(
  id: string,
  data: Prisma.EducationalProgramUpdateInput,
): Promise<ProgramDetailRow> {
  return prisma.educationalProgram.update({ where: { id }, data, select: detailSelect })
}

/** Заменяет набор навыков программы одной транзакцией. */
export async function replaceSkills(
  programId: string,
  skills: Array<{
    skillId: string
    level: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
    importance: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    source: 'CURRICULUM' | 'EXPERT' | 'INTEGRATION' | 'IMPORT' | 'MANUAL' | 'MOCK'
    confidence?: 'LOW' | 'MEDIUM' | 'HIGH' | null
    comment?: string | null
  }>,
): Promise<void> {
  await prisma.$transaction([
    prisma.programSkill.deleteMany({ where: { programId } }),
    ...(skills.length > 0
      ? [
          prisma.programSkill.createMany({
            data: skills.map((skill) => ({
              programId,
              skillId: skill.skillId,
              level: skill.level,
              importance: skill.importance,
              source: skill.source,
              confidence: skill.confidence ?? null,
              comment: skill.comment ?? null,
            })),
          }),
        ]
      : []),
  ])
}

/** Пересчитывает applicationCount по заявкам (решение 9). */
export async function recalcApplicationCount(programId: string): Promise<number> {
  const aggregate = await prisma.application.aggregate({
    where: { programId, status: { in: ['NEW', 'CONFIRMED', 'ENROLLED'] } },
    _sum: { quantity: true },
  })
  const total = aggregate._sum.quantity ?? 0
  await prisma.educationalProgram.update({
    where: { id: programId },
    data: { applicationCount: total, metricsSource: 'MANUAL', metricsUpdatedAt: new Date() },
  })
  return total
}
