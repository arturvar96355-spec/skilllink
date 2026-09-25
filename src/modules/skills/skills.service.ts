import { notFound } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import { prisma } from '@/shared/db/prisma'
import { assertCan, universityScope } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type { SkillDemandDto, SkillDto, SkillGapDto } from '@/shared/contracts/skill'
import type { SkillLevel } from '@/shared/contracts/enums'
import * as repo from './skills.repo'
import { ACTIVE_PROGRAM_WHERE } from '@/modules/programs/programs.rules'
import {
  calculateGap,
  demandNormalizer,
  demandPerSkill,
  directionGroup,
  isInProfile,
  outOfProfileNote,
  type DirectionProfile,
} from './skills.rules'
import type { SkillDemandQuery, SkillGapQuery, SkillListQuery } from './skills.schema'

export async function list(
  user: CurrentUser,
  query: SkillListQuery,
): Promise<{ data: SkillDto[]; meta: PageMeta }> {
  assertCan(user, 'READ')
  const { rows, total } = await repo.findMany(query, universityScope(user))
  return {
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description,
      programCount: row._count.programs,
      productCount: row._count.products,
    })),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}

export interface DemandResult {
  data: SkillDemandDto[]
  /** Сколько строк подходит под фильтры всего — до обрезания по `limit`. */
  total: number
  period: string | null
  isMock: boolean
}

/** Востребованность навыков на рынке. Происхождение каждой строки обязательно. */
export async function demand(user: CurrentUser, query: SkillDemandQuery): Promise<DemandResult> {
  assertCan(user, 'ANALYTICS')

  const period = query.period ?? (await repo.latestPeriod())
  if (!period) return { data: [], total: 0, period: null, isMock: false }

  // Нормируем по всей выборке периода, а не по отфильтрованной странице:
  // иначе масштаб зависел бы от фильтров и показатели нельзя было бы сравнивать.
  const [rows, all, total] = await Promise.all([
    repo.findDemand(query, period),
    repo.findDemandForPeriod(period),
    repo.countDemand(query, period),
  ])
  const normalizeValue = demandNormalizer(all.map((row) => row.value))

  return {
    data: rows.map((row) => ({
      skillId: row.skillId,
      name: row.skill.name,
      category: row.skill.category,
      period: row.period,
      value: row.value,
      unit: row.unit,
      normalized: normalizeValue(row.value),
      region: row.region,
      source: row.source,
      confidence: row.confidence,
      isMock: row.isMock,
    })),
    total,
    period,
    isMock: rows.some((row) => row.isMock),
  }
}

export interface GapResult {
  data: SkillGapDto[]
  /** Сколько дефицитов найдено всего — до обрезания по `limit`. */
  total: number
  /** Сводка по всем навыкам периода — до отбора и обрезания. */
  summary: { demanded: number; covered: number; critical: number }
  period: string | null
  programId: string | null
  isMock: boolean
}

/**
 * Дефицит навыков (skill gap).
 * С programId — по одной программе, иначе сводка по всем активным программам выборки.
 */
export async function gaps(user: CurrentUser, query: SkillGapQuery): Promise<GapResult> {
  assertCan(user, 'ANALYTICS')

  const period = query.period ?? (await repo.latestPeriod())
  if (!period) {
    return {
      data: [],
      total: 0,
      summary: { demanded: 0, covered: 0, critical: 0 },
      period: null,
      programId: query.programId ?? null,
      isMock: false,
    }
  }

  // Профиль — только в разрезе одной программы: у сводки по вузу или по всем
  // программам своей группы направлений нет (решение 98).
  let profile: DirectionProfile | null = null
  if (query.programId) {
    const program = await prisma.educationalProgram.findUnique({
      where: { id: query.programId },
      select: { id: true, code: true },
    })
    if (!program) throw notFound('Образовательная программа не найдена')
    const group = directionGroup(program.code)
    if (group) {
      const taught = await repo.findProgramSkills({
        program: { ...ACTIVE_PROGRAM_WHERE, code: { startsWith: `${group}.` } },
      })
      profile = {
        group,
        skillIds: new Set(taught.map((row) => row.skillId)),
        categories: new Set(taught.map((row) => row.skill.category)),
      }
    }
  }

  const demandRows = demandPerSkill(await repo.findDemandForPeriod(period))
  const normalizeValue = demandNormalizer(demandRows.map((row) => row.value))

  const programSkills = await repo.findProgramSkills(
    query.programId
      ? { programId: query.programId }
      : {
          program: {
            ...ACTIVE_PROGRAM_WHERE,
            ...(query.universityId ? { universityId: query.universityId } : {}),
          },
        },
  )

  /** Лучший достигнутый уровень по навыку среди рассматриваемых программ. */
  const LEVEL_ORDER: Record<SkillLevel, number> = { BASIC: 1, INTERMEDIATE: 2, ADVANCED: 3 }
  const bestLevel = new Map<string, SkillLevel>()
  const importanceBySkill = new Map<string, (typeof programSkills)[number]['importance']>()
  for (const row of programSkills) {
    const current = bestLevel.get(row.skillId)
    if (!current || LEVEL_ORDER[row.level] > LEVEL_ORDER[current]) {
      bestLevel.set(row.skillId, row.level)
    }
    if (!importanceBySkill.has(row.skillId)) importanceBySkill.set(row.skillId, row.importance)
  }

  const result: SkillGapDto[] = demandRows.map((row) => {
    const level = bestLevel.get(row.skillId) ?? null
    const demandNormalized = normalizeValue(row.value)
    const calculation = calculateGap(demandNormalized, level, row.skill.name)
    const outOfProfile =
      profile !== null &&
      level === null &&
      !isInProfile({ id: row.skillId, category: row.skill.category }, profile)
    return {
      skillId: row.skillId,
      name: row.skill.name,
      category: row.skill.category,
      demand: row.value,
      demandNormalized,
      coverage: calculation.coverage,
      level,
      importance: importanceBySkill.get(row.skillId) ?? null,
      gap: calculation.gap,
      isCritical: calculation.isCritical && !outOfProfile,
      explanation: outOfProfile
        ? `${calculation.explanation}. ${outOfProfileNote(row.skill.category, profile!.group)}`
        : calculation.explanation,
      outOfProfile,
      isMock: row.isMock,
    }
  })

  // Сводка — по всем навыкам периода, до отбора и обрезания: главная считала
  // покрытие по первым двумстам строкам, отсортированным по дефициту, и чем больше
  // навыков, тем больше покрытых выпадало из счёта.
  const summary = {
    demanded: result.length,
    covered: result.filter((row) => row.coverage > 0).length,
    critical: result.filter((row) => row.isCritical).length,
  }

  const filtered = query.criticalOnly ? result.filter((row) => row.isCritical) : result
  // Дефициты вне профиля — после своих: наверху то, что про эту программу.
  filtered.sort((a, b) => Number(a.outOfProfile) - Number(b.outOfProfile) || b.gap - a.gap)

  return {
    // `total` считается до обрезания: система, которая существует ради показа
    // дефицитов, не должна занижать их число из-за размера страницы.
    data: filtered.slice(0, query.limit),
    total: filtered.length,
    summary,
    period,
    programId: query.programId ?? null,
    isMock: demandRows.some((row) => row.isMock),
  }
}
