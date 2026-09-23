import { prisma } from '@/shared/db/prisma'
import { textContains } from '@/shared/db/text-search'
import { buildOrderBy, parseSort, toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import { SKILL_SORT_FIELDS, type SkillDemandQuery, type SkillListQuery } from './skills.schema'

/**
 * Число программ с навыком — в пределах видимости: представителю вуза только
 * его программы. Общее число раскрывало бы, сколько программ других вузов учат
 * этому навыку (решение 9).
 */
const skillSelect = (scope: { universityId?: string }) =>
  ({
    id: true,
    name: true,
    category: true,
    description: true,
    _count: {
      select: {
        programs: scope.universityId
          ? { where: { program: { universityId: scope.universityId } } }
          : true,
        products: true,
      },
    },
  }) satisfies Prisma.SkillSelect

export type SkillRow = Prisma.SkillGetPayload<{ select: ReturnType<typeof skillSelect> }>

const demandSelect = {
  id: true,
  skillId: true,
  period: true,
  value: true,
  unit: true,
  region: true,
  source: true,
  confidence: true,
  isMock: true,
  skill: { select: { id: true, name: true, category: true } },
} satisfies Prisma.MarketDemandSelect

export type DemandRow = Prisma.MarketDemandGetPayload<{ select: typeof demandSelect }>

export async function findMany(
  query: SkillListQuery,
  scope: { universityId?: string },
): Promise<{ rows: SkillRow[]; total: number }> {
  const where: Prisma.SkillWhereInput = {}
  if (query.category?.length) where.category = { in: query.category }
  if (query.q) {
    const contains = textContains(query.q)
    where.OR = [{ name: contains }, { category: contains }, { description: contains }]
  }

  const { field, direction } = parseSort(query.sort, SKILL_SORT_FIELDS, {
    field: 'name',
    direction: 'asc',
  })

  const [rows, total] = await Promise.all([
    prisma.skill.findMany({
      where,
      select: skillSelect(scope),
      orderBy: buildOrderBy({ field, direction }),
      ...toSkipTake({ page: query.page, pageSize: query.pageSize }),
    }),
    prisma.skill.count({ where }),
  ])
  return { rows, total }
}

/** Самый свежий период, за который вообще есть рыночные данные. */
export async function latestPeriod(): Promise<string | null> {
  const row = await prisma.marketDemand.findFirst({
    orderBy: { period: 'desc' },
    select: { period: true },
  })
  return row?.period ?? null
}

function demandWhere(query: SkillDemandQuery, period: string): Prisma.MarketDemandWhereInput {
  const where: Prisma.MarketDemandWhereInput = { period }
  if (query.region) where.region = query.region
  if (query.skillId?.length) where.skillId = { in: query.skillId }
  if (query.category?.length) where.skill = { category: { in: query.category } }
  return where
}

export async function findDemand(query: SkillDemandQuery, period: string): Promise<DemandRow[]> {
  return prisma.marketDemand.findMany({
    where: demandWhere(query, period),
    select: demandSelect,
    orderBy: { value: 'desc' },
    take: query.limit,
  })
}

/**
 * Сколько строк подходит под фильтры **до** обрезания по limit.
 *
 * Нужно, чтобы отчёт не выдавал обрезанную выборку за полную: показатель
 * востребованности с заниженным числом — это тихая ложь о рынке.
 */
export async function countDemand(query: SkillDemandQuery, period: string): Promise<number> {
  return prisma.marketDemand.count({ where: demandWhere(query, period) })
}

/** Все рыночные данные за период — нужны, чтобы нормировать спрос по всей выборке. */
export async function findDemandForPeriod(period: string): Promise<DemandRow[]> {
  return prisma.marketDemand.findMany({
    where: { period },
    select: demandSelect,
    orderBy: { value: 'desc' },
  })
}

export async function findProgramSkills(where: Prisma.ProgramSkillWhereInput) {
  return prisma.programSkill.findMany({
    where,
    select: {
      skillId: true,
      level: true,
      importance: true,
      programId: true,
      skill: { select: { id: true, name: true, category: true } },
    },
  })
}
