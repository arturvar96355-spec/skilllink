import { prisma } from '@/shared/db/prisma'
import { RECOMMENDATION_LEARNING } from '@/shared/config/analytics.config'
import type { Prisma } from '@/generated/prisma/client'
import type { RecommendationPriority } from '@/shared/contracts/enums'
import type { RuleStatsScopeType } from '@/shared/contracts/recommendation'
import { ACTIVE_PROGRAM_WHERE } from '@/modules/programs/programs.rules'
import { OPEN_COOPERATION_STATUSES } from '@/modules/cooperation/cooperation.rules'
import { COOPERATION_RULE_KEYS, OPEN_RECOMMENDATION_STATUSES } from './recommendations.rules'
import type { SimulationCandidate } from './recommendations.simulation'
import {
  DAY_MS,
  scopeKeysOf,
  type RecommendationScopes,
  type RuleStatsState,
} from './recommendations.learning'

/**
 * Статистика правил рекомендаций (решение 119) — доступ к базе.
 *
 * Запись — только одним `INSERT … ON CONFLICT DO UPDATE` на пачку событий:
 * затухание считается в SQL от того, что лежит в строке в момент записи,
 * поэтому два параллельных решения не затирают друг друга (строка
 * блокируется на время обновления, второе видит результат первого).
 * Зеркало этой арифметики — `applyEvent` в `recommendations.learning.ts`.
 */

type Client = Prisma.TransactionClient | typeof prisma

export type RuleStatsRow = RuleStatsState & { ruleType: string; scopeType: RuleStatsScopeType; scopeId: string }

/** Событие по правилу на одном уровне: показ или успех. */
export interface RuleStatsDelta {
  ruleType: string
  scopeType: RuleStatsScopeType
  scopeId: string
  count: number
}

/** Показы и успехи пишутся раздельно: у каждого вида своя арифметика в SQL. */
export type RuleEventKind = 'show' | 'success'

/** Складывает события одного ключа: в одном INSERT ключ не может встретиться дважды. */
function aggregate(deltas: readonly RuleStatsDelta[]): RuleStatsDelta[] {
  const byKey = new Map<string, RuleStatsDelta>()
  for (const delta of deltas) {
    if (delta.count <= 0) continue
    const key = `${delta.ruleType}|${delta.scopeType}|${delta.scopeId}`
    const current = byKey.get(key)
    if (current) current.count += delta.count
    else byKey.set(key, { ...delta })
  }
  // Порядок ключей постоянный: пачки параллельных запросов блокируют строки
  // в одном порядке и не ждут друг друга по кругу.
  return [...byKey.values()].sort((a, b) =>
    `${a.ruleType}|${a.scopeType}|${a.scopeId}`.localeCompare(`${b.ruleType}|${b.scopeType}|${b.scopeId}`),
  )
}

/**
 * coef = 0,5^(Δt / H), Δt — от прошлого обновления строки до события, не меньше нуля.
 * Одно и то же выражение во всех полях — поэтому successes_eff ≤ trials_eff держится
 * точно, без погрешности округления.
 */
const COEF = `power(0.5::float8, GREATEST(0::float8, EXTRACT(EPOCH FROM (EXCLUDED.eff_updated_at - s.eff_updated_at))::float8) / $6::float8)`

/**
 * Показ: trials + n, trials_eff := trials_eff·coef + n; успехи только остывают.
 * Успех: successes + n, successes_eff := successes_eff·coef + n, показы не меньше
 * успехов — и в полных, и в эффективных счётчиках.
 */
const UPSERT_SQL: Record<RuleEventKind, string> = {
  show: `
    INSERT INTO recommendation_rule_stats AS s
      (rule_type, scope_type, scope_id, trials, successes, trials_eff, successes_eff, eff_updated_at)
    SELECT e.rule_type, e.scope_type, e.scope_id, e.n, 0, e.n::float8, 0, $5::timestamptz
      FROM unnest($1::text[], $2::text[], $3::text[], $4::int[]) AS e(rule_type, scope_type, scope_id, n)
    ON CONFLICT (rule_type, scope_type, scope_id) DO UPDATE SET
      trials = s.trials + EXCLUDED.trials,
      trials_eff = GREATEST(s.trials_eff * ${COEF} + EXCLUDED.trials_eff, s.successes_eff * ${COEF} + EXCLUDED.successes_eff),
      successes_eff = s.successes_eff * ${COEF} + EXCLUDED.successes_eff,
      eff_updated_at = GREATEST(s.eff_updated_at, EXCLUDED.eff_updated_at)`,
  success: `
    INSERT INTO recommendation_rule_stats AS s
      (rule_type, scope_type, scope_id, trials, successes, trials_eff, successes_eff, eff_updated_at)
    SELECT e.rule_type, e.scope_type, e.scope_id, e.n, e.n, e.n::float8, e.n::float8, $5::timestamptz
      FROM unnest($1::text[], $2::text[], $3::text[], $4::int[]) AS e(rule_type, scope_type, scope_id, n)
    ON CONFLICT (rule_type, scope_type, scope_id) DO UPDATE SET
      successes = s.successes + EXCLUDED.successes,
      trials = GREATEST(s.trials, s.successes + EXCLUDED.successes),
      trials_eff = GREATEST(s.trials_eff * ${COEF}, s.successes_eff * ${COEF} + EXCLUDED.successes_eff),
      successes_eff = s.successes_eff * ${COEF} + EXCLUDED.successes_eff,
      eff_updated_at = GREATEST(s.eff_updated_at, EXCLUDED.eff_updated_at)`,
}

/**
 * Записывает пачку событий одного вида одним запросом. `at` — момент события
 * (сейчас; в симуляции и сиде — момент из истории).
 */
export async function recordRuleEvents(
  kind: RuleEventKind,
  deltas: readonly RuleStatsDelta[],
  at: Date,
  client: Client = prisma,
  halfLifeDays: number = RECOMMENDATION_LEARNING.halfLifeDays,
): Promise<number> {
  const rows = aggregate(deltas)
  if (rows.length === 0) return 0
  return client.$executeRawUnsafe(
    UPSERT_SQL[kind],
    rows.map((row) => row.ruleType),
    rows.map((row) => row.scopeType),
    rows.map((row) => row.scopeId),
    rows.map((row) => row.count),
    at.toISOString(),
    halfLifeDays * (DAY_MS / 1000),
  )
}

export async function loadRuleStats(client: Client = prisma): Promise<RuleStatsRow[]> {
  const rows = await client.recommendationRuleStats.findMany({
    orderBy: [{ ruleType: 'asc' }, { scopeType: 'asc' }, { scopeId: 'asc' }],
  })
  return rows.map((row) => ({ ...row, scopeType: row.scopeType as RuleStatsScopeType }))
}

/** Рекомендация — в объёме, нужном для уровней статистики. */
export interface ScopeSource {
  id: string
  ruleKey: string
  objectType: string
  objectId: string
  cooperationId: string | null
}

/**
 * Вуз и менеджер каждой рекомендации: у связки — её вуз и ответственный,
 * у программы — её вуз, у навыка — только общий уровень.
 */
export async function resolveScopes(
  rows: readonly ScopeSource[],
  client: Client = prisma,
): Promise<Map<string, RecommendationScopes>> {
  const cooperationIds = [...new Set(rows.map((row) => row.cooperationId).filter((id): id is string => id !== null))]
  const programIds = [
    ...new Set(rows.filter((row) => row.objectType === 'EducationalProgram').map((row) => row.objectId)),
  ]
  const [cooperations, programs] = await Promise.all([
    cooperationIds.length
      ? client.cooperation.findMany({
          where: { id: { in: cooperationIds } },
          select: { id: true, universityId: true, responsibleId: true },
        })
      : [],
    programIds.length
      ? client.educationalProgram.findMany({ where: { id: { in: programIds } }, select: { id: true, universityId: true } })
      : [],
  ])
  const cooperationById = new Map(cooperations.map((row) => [row.id, row]))
  const programById = new Map(programs.map((row) => [row.id, row]))

  const result = new Map<string, RecommendationScopes>()
  for (const row of rows) {
    const cooperation = row.cooperationId ? cooperationById.get(row.cooperationId) : undefined
    const program = row.objectType === 'EducationalProgram' ? programById.get(row.objectId) : undefined
    result.set(row.id, {
      universityId: cooperation?.universityId ?? program?.universityId ?? null,
      managerId: cooperation?.responsibleId ?? null,
    })
  }
  return result
}

/** События по рекомендациям → приращения на всех их уровнях. */
export function deltasFor(
  rows: readonly ScopeSource[],
  scopes: ReadonlyMap<string, RecommendationScopes>,
): RuleStatsDelta[] {
  return rows.flatMap((row) =>
    scopeKeysOf(scopes.get(row.id) ?? { universityId: null, managerId: null }).map((key) => ({
      ruleType: row.ruleKey,
      ...key,
      count: 1,
    })),
  )
}

/** Показ рекомендаций: в статистику их правил на всех уровнях. */
export async function recordShows(rows: readonly ScopeSource[], at: Date): Promise<void> {
  if (rows.length === 0) return
  const scopes = await resolveScopes(rows)
  await recordRuleEvents('show', deltasFor(rows, scopes), at)
}

/**
 * Засчитывает рекомендации полезными — не больше одного раза на показ.
 *
 * Отметка `success_at` и запись статистики — в одной транзакции: либо оба,
 * либо ничего. Условие в UPDATE отсекает повтор (двойной клик, закрытие системой
 * после закрытия человеком, бонус за этап после закрытия): успех по показу уже есть.
 * Записи без показа (созданные до обучения) не засчитываются — их показа нет в статистике.
 */
export async function creditSuccesses(ids: readonly string[], at: Date): Promise<number> {
  if (ids.length === 0) return 0
  return prisma.$transaction(async (tx) => {
    const credited = await tx.$queryRawUnsafe<
      Array<{ id: string; rule_key: string; object_type: string; object_id: string; cooperation_id: string | null }>
    >(
      `UPDATE recommendations SET success_at = $2::timestamp
        WHERE id = ANY($1::text[])
          AND shown_at IS NOT NULL
          AND (success_at IS NULL OR success_at < shown_at)
        RETURNING id, rule_key, object_type, object_id, cooperation_id`,
      [...ids],
      at.toISOString(),
    )
    const rows = credited.map((row) => ({
      id: row.id,
      ruleKey: row.rule_key,
      objectType: row.object_type,
      objectId: row.object_id,
      cooperationId: row.cooperation_id,
    }))
    if (rows.length === 0) return 0
    await recordRuleEvents('success', deltasFor(rows, await resolveScopes(rows, tx)), at, tx)
    return rows.length
  })
}

/** Показано и выполнено у каждого менеджера с `since` — для защиты от перегрузки. */
export async function managerLoads(since: Date): Promise<Map<string, { shown: number; done: number }>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ manager_id: string; shown: number; done: number }>>(
    `SELECT c.responsible_id AS manager_id,
            count(*)::int AS shown,
            count(*) FILTER (WHERE r.status = 'DONE')::int AS done
       FROM recommendations r
       JOIN cooperations c ON c.id = r.cooperation_id
      WHERE r.shown_at >= $1::timestamp
      GROUP BY c.responsible_id`,
    since.toISOString(),
  )
  return new Map(rows.map((row) => [row.manager_id, { shown: Number(row.shown), done: Number(row.done) }]))
}

/** Открытые рекомендации — всё, что нужно пересчёту балла. */
export async function loadOpenForScoring(): Promise<
  Array<
    ScopeSource & {
      priority: RecommendationPriority
      relatedData: unknown
      reasons: unknown
      score: number | null
      isDeferred: boolean
    }
  >
> {
  return prisma.recommendation.findMany({
    where: { status: { in: [...OPEN_RECOMMENDATION_STATUSES] } },
    select: {
      id: true,
      ruleKey: true,
      objectType: true,
      objectId: true,
      cooperationId: true,
      priority: true,
      relatedData: true,
      reasons: true,
      score: true,
      isDeferred: true,
    },
    orderBy: { id: 'asc' },
  })
}

export interface ScoreUpdate {
  id: string
  score: number
  breakdown: unknown
  reasons: unknown
  isDeferred: boolean
}

/**
 * Балл, разбор, причины и пометка «отложено» — одним запросом на пачку.
 * `updated_at` не трогается: пересчёт балла — не правка рекомендации.
 */
export async function saveScores(updates: readonly ScoreUpdate[]): Promise<number> {
  if (updates.length === 0) return 0
  return prisma.$executeRawUnsafe(
    `UPDATE recommendations r
        SET score = v.score, score_breakdown = v.breakdown::jsonb, reasons = v.reasons::jsonb, is_deferred = v.deferred
       FROM unnest($1::text[], $2::float8[], $3::text[], $4::text[], $5::bool[])
         AS v(id, score, breakdown, reasons, deferred)
      WHERE r.id = v.id`,
    updates.map((row) => row.id),
    updates.map((row) => row.score),
    updates.map((row) => JSON.stringify(row.breakdown)),
    updates.map((row) => JSON.stringify(row.reasons)),
    updates.map((row) => row.isDeferred),
  )
}

/** Названия вузов для уровней статистики. */
export async function universityNames(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await prisma.university.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, shortName: true },
  })
  return new Map(rows.map((row) => [row.id, row.shortName ?? row.name]))
}

/**
 * Кандидаты для модели решений (симуляция, история в демо-данных): каждое
 * правило на каждом объекте своего вида — за 90 дней условия меняются, и любое
 * правило рано или поздно срабатывает на любом объекте. Только чтение.
 */
export async function loadSimulationCandidates(): Promise<SimulationCandidate[]> {
  const [cooperations, programs, skills] = await Promise.all([
    prisma.cooperation.findMany({
      where: { status: { in: [...OPEN_COOPERATION_STATUSES] } },
      select: { universityId: true, responsibleId: true },
      orderBy: { id: 'asc' },
    }),
    prisma.educationalProgram.findMany({
      where: ACTIVE_PROGRAM_WHERE,
      select: { universityId: true },
      orderBy: { id: 'asc' },
    }),
    prisma.marketDemand.findMany({ distinct: ['skillId'], select: { skillId: true }, orderBy: { skillId: 'asc' } }),
  ])
  return [
    ...cooperations.flatMap((row) =>
      COOPERATION_RULE_KEYS.map((ruleKey) => ({
        ruleKey,
        scopes: { universityId: row.universityId, managerId: row.responsibleId },
      })),
    ),
    ...programs.map((row) => ({
      ruleKey: 'program.missing-metrics',
      scopes: { universityId: row.universityId, managerId: null },
    })),
    ...skills.map(() => ({
      ruleKey: 'skill.critical-gap-with-product',
      scopes: { universityId: null, managerId: null },
    })),
  ]
}

/** Стирает статистику правил — только для перезаливки демо-данных. */
export async function wipeRuleStats(): Promise<void> {
  await prisma.recommendationRuleStats.deleteMany()
}

/** Загружен демо-набор — его история решений смоделирована сидом. */
export async function hasMockData(): Promise<boolean> {
  return (await prisma.cooperation.count({ where: { isMock: true }, take: 1 })) > 0
}
