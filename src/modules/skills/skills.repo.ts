import { prisma } from '@/shared/db/prisma'
import { textContains } from '@/shared/db/text-search'
import { buildOrderBy, parseSort, toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import { renameSkillInRecommendation } from '@/modules/recommendations/recommendations.rules'
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
 * этому навыку.
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
 * Названия всех навыков — только `id` и `name`. Справочник — десятки строк,
 * в пределе сотни: навык, с которым совпало название, ищется в коде той же
 * функцией, что повторяет индекс базы (`skillNameKey`), — чтобы назвать его в ответе.
 */
async function allNames(client: Tx | typeof prisma = prisma): Promise<Array<{ id: string; name: string }>> {
  return client.skill.findMany({ select: { id: true, name: true } })
}

export type NameGuarded<T> = { ok: true; row: T } | { ok: false; clash: { id: string; name: string } }

/** P2002 — нарушение уникальности. У навыка уникально только название: другой причины нет. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
}

/**
 * Уникальность названия без учёта регистра и пробелов держит база — индекс
 * `skills_name_key_ci` (решение 110). Проверка в коде до записи нужна для
 * понятного ответа: «совпадает с „Machine Learning“». Между проверкой и записью
 * то же название может сохранить параллельный запрос — тогда откажет индекс,
 * и ответ должен быть тем же 409 с названием, а не общим «запись уже существует».
 */
async function guardName<T>(
  name: string | undefined,
  excludeId: string | undefined,
  write: () => Promise<T>,
): Promise<NameGuarded<T>> {
  if (name !== undefined) {
    const clash = findNameClash(name, await allNames(), excludeId)
    if (clash) return { ok: false, clash }
  }
  try {
    return { ok: true, row: await write() }
  } catch (error) {
    if (name === undefined || !isUniqueViolation(error)) throw error
    // Соперник мог уже исчезнуть (объединён, удалён) — тогда называем то, что ввели.
    const clash = findNameClash(name, await allNames(), excludeId) ?? { id: '', name }
    return { ok: false, clash }
  }
}

export async function createSkill(input: CreateSkillInput): Promise<NameGuarded<SkillRow>> {
  return guardName(input.name, undefined, () =>
    prisma.skill.create({
      data: { name: input.name, category: input.category, description: input.description ?? null },
      select: skillSelect({}),
    }),
  )
}

/**
 * Рекомендации навыка называют его так, как он называется сейчас (решение 110).
 * Вызывается в транзакции переименования и объединения: запись навыка и текст
 * рекомендаций меняются вместе или не меняются вовсе.
 */
async function renameInRecommendations(skill: { id: string; name: string }, tx: Tx): Promise<number> {
  const rows = await tx.recommendation.findMany({
    where: { objectType: 'Skill', objectId: skill.id },
    select: { id: true, ruleKey: true, title: true, description: true, relatedData: true },
  })
  let changed = 0
  for (const row of rows) {
    const patch = renameSkillInRecommendation(row, skill)
    if (!patch) continue
    await tx.recommendation.update({
      where: { id: row.id },
      data: {
        title: patch.title,
        description: patch.description,
        // Ссылка на навык не менялась — поле не пишется: пустой relatedData (NULL)
        // Prisma не примет как обычное значение JSON.
        ...(patch.relatedData !== row.relatedData
          ? { relatedData: patch.relatedData as Prisma.InputJsonValue }
          : {}),
      },
    })
    changed += 1
  }
  return changed
}

/** `null` — навыка нет. */
export async function updateSkill(
  id: string,
  input: UpdateSkillInput,
): Promise<NameGuarded<SkillRow> | null> {
  const existing = await prisma.skill.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return null
  return guardName(input.name, id, () =>
    prisma.$transaction(async (tx) => {
      const row = await tx.skill.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
        select: skillSelect({}),
      })
      if (input.name !== undefined) await renameInRecommendations({ id, name: row.name }, tx)
      return row
    }),
  )
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

async function applyMergePlan(
  plan: SkillMergePlan,
  target: { id: string; name: string },
  tx: Tx,
): Promise<void> {
  const targetId = target.id
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
    await tx.recommendation.updateMany({
      where: { id: { in: plan.recommendations.move } },
      data: { objectId: targetId },
    })
    // Текст — в той же транзакции, а не «при следующей генерации»: до неё
    // лента называла бы навык, которого в справочнике уже нет (решение 110).
    await renameInRecommendations(target, tx)
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
      tx.skill.findUnique({ where: { id: targetId }, select: { id: true, name: true } }),
    ])
    if (!source) return { status: 'not-found', which: 'source' }
    if (!target) return { status: 'not-found', which: 'target' }

    const [sourceLinks, targetLinks] = await Promise.all([loadLinks(sourceId, tx), loadLinks(targetId, tx)])
    const plan = planSkillMerge(targetLinks, sourceLinks)
    await applyMergePlan(plan, target, tx)
    await tx.skill.delete({ where: { id: sourceId } })

    const row = await findById(targetId, tx)
    return { status: 'merged', removed: source, target: row!, plan }
  })
}
