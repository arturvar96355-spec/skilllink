import { prisma } from '@/shared/db/prisma'
import { textContains } from '@/shared/db/text-search'
import { buildOrderBy, parseSort, toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import {
  findNameClash,
  latestOfPeriods,
  planSkillMerge,
  type SkillLinks,
  type SkillMergePlan,
  type SkillUsage,
} from './skills.rules'
import {
  SKILL_SORT_FIELDS,
  type CreateSkillInput,
  type SkillDemandQuery,
  type SkillListQuery,
  type UpdateSkillInput,
} from './skills.schema'

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
  const rows = await prisma.marketDemand.findMany({ distinct: ['period'], select: { period: true } })
  return latestOfPeriods(rows.map((row) => row.period))
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

// ── Справочник навыков: управление (решение 107) ─────────────────────────────

type Tx = Prisma.TransactionClient

/** Навык для администратора: счётчики без сужения по вузу. */
export async function findById(id: string, client: Tx | typeof prisma = prisma): Promise<SkillRow | null> {
  return client.skill.findUnique({ where: { id }, select: skillSelect({}) })
}

/**
 * Проверка названия и запись — под одной транзакционной блокировкой справочника.
 *
 * Уникальность «без учёта регистра и пробелов» база сама не держит (её ключ —
 * точное название), поэтому два одновременных «Python» и «python» иначе прошли бы
 * оба. Блокировка рекомендательная и живёт до конца транзакции; справочник меняет
 * администратор, очередь из двух запросов незаметна.
 */
async function withNameLock<T>(action: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext('skilllink:skills:name'))) AS locked`
    return action(tx)
  })
}

/**
 * Названия всех навыков — только `id` и `name`. Справочник — десятки строк,
 * в пределе сотни: сравнение по ключу делается в коде одной функцией
 * (`skillNameKey`, её проверяют модульные тесты), а не повтором правила на SQL.
 */
async function allNames(tx: Tx): Promise<Array<{ id: string; name: string }>> {
  return tx.skill.findMany({ select: { id: true, name: true } })
}

export type NameGuarded<T> = { ok: true; row: T } | { ok: false; clash: { id: string; name: string } }

export async function createSkill(input: CreateSkillInput): Promise<NameGuarded<SkillRow>> {
  return withNameLock(async (tx) => {
    const clash = findNameClash(input.name, await allNames(tx))
    if (clash) return { ok: false, clash }
    const row = await tx.skill.create({
      data: { name: input.name, category: input.category, description: input.description ?? null },
      select: skillSelect({}),
    })
    return { ok: true, row }
  })
}

export async function updateSkill(
  id: string,
  input: UpdateSkillInput,
): Promise<NameGuarded<SkillRow> | null> {
  return withNameLock(async (tx) => {
    const existing = await tx.skill.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return null
    if (input.name !== undefined) {
      const clash = findNameClash(input.name, await allNames(tx), id)
      if (clash) return { ok: false, clash }
    }
    const row = await tx.skill.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
      select: skillSelect({}),
    })
    return { ok: true, row }
  })
}

async function countUsage(id: string, client: Tx | typeof prisma): Promise<SkillUsage> {
  const [programs, products, demand, recommendations] = await Promise.all([
    client.programSkill.count({ where: { skillId: id } }),
    client.productSkill.count({ where: { skillId: id } }),
    client.marketDemand.count({ where: { skillId: id } }),
    client.recommendation.count({ where: { objectType: 'Skill', objectId: id } }),
  ])
  return { programs, products, demand, recommendations }
}

/**
 * Удаление неиспользуемого навыка. Строка навыка блокируется, и использование
 * пересчитывается внутри транзакции: между проверкой и удалением навык могли
 * добавить в программу, и каскад тихо стёр бы эту связь.
 */
export async function deleteIfUnused(
  id: string,
  isUsed: (usage: SkillUsage) => boolean,
): Promise<{ deleted: { id: string; name: string } } | { usage: SkillUsage; name: string } | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM skills WHERE id = ${id} FOR UPDATE`
    const row = await tx.skill.findUnique({ where: { id }, select: { id: true, name: true } })
    if (!row) return null
    const usage = await countUsage(id, tx)
    if (isUsed(usage)) return { usage, name: row.name }
    await tx.skill.delete({ where: { id } })
    return { deleted: row }
  })
}

async function loadLinks(skillId: string, tx: Tx): Promise<SkillLinks> {
  const [programs, products, demand, recommendations] = await Promise.all([
    tx.programSkill.findMany({
      where: { skillId },
      select: { id: true, programId: true, level: true, importance: true, source: true, confidence: true, comment: true },
    }),
    tx.productSkill.findMany({ where: { skillId }, select: { id: true, productId: true, relevance: true } }),
    tx.marketDemand.findMany({
      where: { skillId },
      select: {
        id: true,
        period: true,
        source: true,
        region: true,
        value: true,
        unit: true,
        confidence: true,
        isMock: true,
        dataSourceId: true,
      },
    }),
    tx.recommendation.findMany({
      where: { objectType: 'Skill', objectId: skillId },
      select: { id: true, ruleKey: true },
    }),
  ])
  return { programs, products, demand, recommendations }
}

async function applyMergePlan(plan: SkillMergePlan, targetId: string, tx: Tx): Promise<void> {
  // Сначала то, что совпало (связь дубля удаляется), потом перенос остального:
  // перенос раньше удаления упёрся бы в уникальность «программа — навык».
  for (const item of plan.programs.combine) {
    await tx.programSkill.update({ where: { id: item.targetId }, data: item.data })
    await tx.programSkill.delete({ where: { id: item.duplicateId } })
  }
  if (plan.programs.move.length > 0) {
    await tx.programSkill.updateMany({ where: { id: { in: plan.programs.move } }, data: { skillId: targetId } })
  }

  for (const item of plan.products.combine) {
    await tx.productSkill.update({ where: { id: item.targetId }, data: { relevance: item.relevance } })
    await tx.productSkill.delete({ where: { id: item.duplicateId } })
  }
  if (plan.products.move.length > 0) {
    await tx.productSkill.updateMany({ where: { id: { in: plan.products.move } }, data: { skillId: targetId } })
  }

  for (const item of plan.demand.combine) {
    await tx.marketDemand.delete({ where: { id: item.duplicateId } })
    if (item.replaceWith) {
      const { value, unit, confidence, isMock, dataSourceId } = item.replaceWith
      await tx.marketDemand.update({
        where: { id: item.targetId },
        data: { value, unit, confidence, isMock, dataSourceId },
      })
    }
  }
  if (plan.demand.move.length > 0) {
    await tx.marketDemand.updateMany({ where: { id: { in: plan.demand.move } }, data: { skillId: targetId } })
  }

  if (plan.recommendations.drop.length > 0) {
    await tx.recommendation.deleteMany({ where: { id: { in: plan.recommendations.drop } } })
  }
  if (plan.recommendations.move.length > 0) {
    // Текст и relatedData перепишет следующая пересборка: правило выдаст ту же
    // рекомендацию уже по целевому навыку и обновит запись по ключу.
    await tx.recommendation.updateMany({
      where: { id: { in: plan.recommendations.move } },
      data: { objectId: targetId },
    })
  }
}

export type MergeOutcome =
  | { status: 'not-found'; which: 'source' | 'target' }
  | {
      status: 'merged'
      removed: { id: string; name: string }
      target: SkillRow
      plan: SkillMergePlan
    }

/**
 * Объединение дубля в целевой навык — одной транзакцией: связи программ и продуктов,
 * рыночные замеры и рекомендации переходят на целевой навык, дубль удаляется.
 * Обе строки навыков блокируются в порядке id: встречные объединения A→B и B→A
 * иначе взаимно заблокировались бы.
 */
export async function mergeInto(sourceId: string, targetId: string): Promise<MergeOutcome> {
  return prisma.$transaction(async (tx) => {
    const [first, second] = [sourceId, targetId].sort()
    await tx.$queryRaw`SELECT id FROM skills WHERE id = ${first} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM skills WHERE id = ${second} FOR UPDATE`

    const [source, target] = await Promise.all([
      tx.skill.findUnique({ where: { id: sourceId }, select: { id: true, name: true } }),
      tx.skill.findUnique({ where: { id: targetId }, select: { id: true } }),
    ])
    if (!source) return { status: 'not-found', which: 'source' }
    if (!target) return { status: 'not-found', which: 'target' }

    const [sourceLinks, targetLinks] = await Promise.all([loadLinks(sourceId, tx), loadLinks(targetId, tx)])
    const plan = planSkillMerge(targetLinks, sourceLinks)
    await applyMergePlan(plan, targetId, tx)
    await tx.skill.delete({ where: { id: sourceId } })

    const row = await findById(targetId, tx)
    return { status: 'merged', removed: source, target: row!, plan }
  })
}
