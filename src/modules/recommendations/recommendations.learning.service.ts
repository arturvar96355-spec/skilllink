import { notFound } from '@/shared/http/errors'
import { assertCan } from '@/shared/auth/permissions'
import { RECOMMENDATION_LEARNING } from '@/shared/config/analytics.config'
import type { CurrentUser } from '@/shared/auth/current-user'
import type {
  RecommendationReasonDto,
  RuleStatsDto,
  RuleStatsListDto,
  RuleWeightDto,
  WhyNotDto,
  WhyNotRuleDto,
} from '@/shared/contracts/recommendation'
import type { RecommendationStatus } from '@/shared/contracts/enums'
import { COOPERATION_STATUS_LABELS } from '@/shared/contracts/labels'
import { OPEN_COOPERATION_STATUSES } from '@/modules/cooperation/cooperation.rules'
import * as repo from './recommendations.repo'
import * as statsRepo from './recommendations.stats.repo'
import {
  COOPERATION_RULE_KEYS,
  RULE_DISPLAY_ORDER,
  evaluateCooperation,
  evaluateProgram,
  evaluateSkillGaps,
  type RuleEvaluation,
} from './recommendations.rules'
import {
  DAY_MS,
  GLOBAL_SCOPE_ID,
  credibleInterval90,
  indexStats,
  ruleProbability,
  type RecommendationScopes,
  type StatsIndex,
} from './recommendations.learning'
import { explainRule, isRuleEnabled, planRescore, type ExistingRecommendation } from './recommendations.explain'
import { reason, ruleLabel } from './recommendations.reasons'

/**
 * Обучение и объяснимость рекомендаций (решение 119): пересчёт балла,
 * «почему нет рекомендации» и веса правил.
 */

/**
 * Пересчитывает балл, разбор, причины и пометку «отложено» у всех открытых
 * рекомендаций. Вызывается после пересборки и после решения, меняющего вес правила.
 */
export async function rescoreOpen(now: Date = new Date()): Promise<number> {
  const rows = await statsRepo.loadOpenForScoring()
  if (rows.length === 0) return 0
  const [stats, scopes, loads] = await Promise.all([
    statsRepo.loadRuleStats(),
    statsRepo.resolveScopes(rows),
    statsRepo.managerLoads(new Date(now.getTime() - RECOMMENDATION_LEARNING.overloadWindowDays * DAY_MS)),
  ])
  const random = RECOMMENDATION_LEARNING.sampling === 'thompson' ? Math.random : undefined
  const plan = planRescore(rows, scopes, indexStats(stats), loads, now, RECOMMENDATION_LEARNING, random)
  return statsRepo.saveScores(plan)
}

// ─────────────────────────── Почему нет рекомендации ─────────────────────────

const OBJECT_TYPE = {
  program: 'EducationalProgram',
  cooperation: 'Cooperation',
  skill: 'Skill',
} as const

function existingOf(
  rows: ReadonlyArray<{ id: string; ruleKey: string; status: RecommendationStatus; resolvedAt: Date | null; isDeferred: boolean }>,
  ruleKey: string,
): ExistingRecommendation | null {
  return rows.find((row) => row.ruleKey === ruleKey) ?? null
}

/**
 * «Почему по объекту нет рекомендации»: те же функции проверок, что у пересборки
 * (`evaluateCooperation`, `evaluateProgram`, `evaluateSkillGaps`), плюс общие —
 * правило включено, объект в работе, пауза после отклонения.
 */
export async function whyNot(
  user: CurrentUser,
  query: { entity: 'program' | 'cooperation' | 'skill'; id: string; rule?: string },
): Promise<WhyNotDto> {
  assertCan(user, 'ANALYTICS')
  const now = new Date()
  const objectType = OBJECT_TYPE[query.entity]

  let label: string
  let objectChecks: RecommendationReasonDto[] = []
  let evaluations: RuleEvaluation[]
  let ruleKeys: readonly string[]

  if (query.entity === 'cooperation') {
    const cooperation = await repo.loadCooperationAnyStatus(query.id)
    if (!cooperation) throw notFound('Связка не найдена')
    label = `${cooperation.university.name} — ${cooperation.program.name}`
    const open = (OPEN_COOPERATION_STATUSES as readonly string[]).includes(cooperation.status)
    objectChecks = [
      reason('cooperation_open', open, { statusLabel: COOPERATION_STATUS_LABELS[cooperation.status].toLowerCase() }),
    ]
    evaluations = evaluateCooperation(cooperation, now)
    ruleKeys = COOPERATION_RULE_KEYS
  } else if (query.entity === 'program') {
    const program = await repo.loadProgramAnyStatus(query.id)
    if (!program) throw notFound('Программа не найдена')
    label = `${program.name} · ${program.university.name}`
    const active = (await repo.loadProgramForRules(query.id)) !== null
    objectChecks = [reason('program_active', active, { programName: program.name })]
    evaluations = [evaluateProgram(program)]
    ruleKeys = ['program.missing-metrics']
  } else {
    const skill = await repo.findSkill(query.id)
    if (!skill) throw notFound('Навык не найден')
    label = `Навык «${skill.name}»`
    const input = await repo.loadGenerationInput()
    evaluations = evaluateSkillGaps(input).evaluations.filter((item) => item.objectId === skill.id)
    if (evaluations.length === 0) {
      // Рыночных данных по навыку нет — правило до него не доходит; причина та же, что у правила.
      evaluations = [
        {
          ruleKey: 'skill.critical-gap-with-product',
          objectType: 'Skill',
          objectId: skill.id,
          checks: [reason('demand_above_threshold', false, { skillName: skill.name, demand: null })],
          draft: null,
        },
      ]
    }
    ruleKeys = ['skill.critical-gap-with-product']
  }

  if (query.rule && !ruleKeys.includes(query.rule)) {
    throw notFound(`Правило ${query.rule} не относится к объектам этого вида`)
  }
  const existing = await repo.findByObject(objectType, query.id)
  const rules: WhyNotRuleDto[] = ruleKeys
    .filter((ruleKey) => !query.rule || ruleKey === query.rule)
    .map((ruleKey) =>
      explainRule({
        ruleKey,
        enabled: isRuleEnabled(ruleKey),
        objectChecks,
        evaluation: evaluations.find((item) => item.ruleKey === ruleKey) ?? null,
        existing: existingOf(existing, ruleKey),
        now,
      }),
    )

  return {
    entity: query.entity,
    id: query.id,
    label,
    rules,
    checks: rules.flatMap((rule) => rule.checks),
    checkedAt: now.toISOString(),
  }
}

// ─────────────────────────── Веса правил ─────────────────────────────────────

function weightOf(
  index: StatsIndex,
  row: statsRepo.RuleStatsRow | undefined,
  ruleKey: string,
  scopeType: RuleWeightDto['scopeType'],
  scopeId: string,
  scopeLabel: string | null,
  now: Date,
): RuleWeightDto {
  const scopes: RecommendationScopes = {
    universityId: scopeType === 'university' ? scopeId : null,
    managerId: scopeType === 'manager' ? scopeId : null,
  }
  const probability = ruleProbability(index, ruleKey, scopes, now)
  const [low, high] = credibleInterval90(probability.posterior)
  return {
    scopeType,
    scopeId,
    scopeLabel,
    p: probability.p,
    pSource: probability.pSource,
    ci90: [low, high],
    trials: row?.trials ?? 0,
    successes: row?.successes ?? 0,
    trialsEff: probability.trialsEff,
    successesEff: probability.successesEff,
    updatedAt: row ? row.effUpdatedAt.toISOString() : null,
  }
}

/**
 * Вес каждого правила: вероятность полезности на сегодня, 90-процентный интервал,
 * полные и эффективные счётчики — общий уровень и уровни вузов и менеджеров.
 */
export async function ruleStats(user: CurrentUser): Promise<RuleStatsListDto> {
  assertCan(user, 'ANALYTICS')
  const now = new Date()
  const [rows, isMock] = await Promise.all([statsRepo.loadRuleStats(), statsRepo.hasMockData()])
  const index = indexStats(rows)
  const universityLabels = await statsRepo.universityNames(
    rows.filter((row) => row.scopeType === 'university').map((row) => row.scopeId),
  )

  const rules: RuleStatsDto[] = RULE_DISPLAY_ORDER.map((ruleKey) => {
    const global = weightOf(
      index,
      rows.find((row) => row.ruleType === ruleKey && row.scopeType === 'global'),
      ruleKey,
      'global',
      GLOBAL_SCOPE_ID,
      null,
      now,
    )
    const scopes = rows
      .filter((row) => row.ruleType === ruleKey && row.scopeType !== 'global')
      .map((row) =>
        weightOf(
          index,
          row,
          ruleKey,
          row.scopeType,
          row.scopeId,
          row.scopeType === 'university' ? (universityLabels.get(row.scopeId) ?? null) : null,
          now,
        ),
      )
    return { ruleKey, ruleLabel: ruleLabel(ruleKey), enabled: isRuleEnabled(ruleKey), ...global, scopes }
  })

  return {
    rules,
    halfLifeDays: RECOMMENDATION_LEARNING.halfLifeDays,
    poolingStrength: RECOMMENDATION_LEARNING.poolingStrength,
    sampling: RECOMMENDATION_LEARNING.sampling,
    isMock,
    computedAt: now.toISOString(),
  }
}
