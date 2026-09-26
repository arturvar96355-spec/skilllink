import { RECOMMENDATION_DISABLED_RULES, RECOMMENDATION_LEARNING } from '@/shared/config/analytics.config'
import type { RecommendationStatus } from '@/shared/contracts/enums'
import type {
  RecommendationReasonDto,
  WhyNotCheckDto,
  WhyNotRuleDto,
} from '@/shared/contracts/recommendation'
import {
  dismissalPause,
  isOverloaded,
  scoreRecommendation,
  shouldDefer,
  type LearningConfig,
  type ManagerLoad,
  type Random,
  type RecommendationScopes,
  type StatsIndex,
} from './recommendations.learning'
import { LEARNING_REASON_CODES, allPass, parseReasons, reason, ruleLabel } from './recommendations.reasons'
import type { RuleEvaluation } from './recommendations.rules'

/**
 * Объяснимость рекомендаций (решение 119) — чистые функции без базы:
 * «почему нет рекомендации» и пометки обучения к баллу.
 */

export function isRuleEnabled(ruleKey: string, disabled: readonly string[] = RECOMMENDATION_DISABLED_RULES): boolean {
  return !disabled.includes(ruleKey)
}

/** Уже существующая запись по правилу и объекту — для паузы и ответа «почему нет». */
export interface ExistingRecommendation {
  id: string
  status: RecommendationStatus
  resolvedAt: Date | null
  isDeferred: boolean
}

/**
 * Ответ «почему нет рекомендации» по одному правилу: общие проверки (правило
 * включено, объект в работе), проверки самого правила — **те же**, что дали или
 * не дали черновик при пересборке (`evaluation`), — и пауза после отклонения.
 *
 * `wouldRecommend` — все проверки пройдены: при пересборке правило выдаст
 * (или уже выдало) рекомендацию.
 */
export function explainRule(args: {
  ruleKey: string
  enabled: boolean
  objectChecks: RecommendationReasonDto[]
  evaluation: Pick<RuleEvaluation, 'checks'> | null
  existing: ExistingRecommendation | null
  now: Date
  pauseDays?: number
}): WhyNotRuleDto {
  const pauseDays = args.pauseDays ?? RECOMMENDATION_LEARNING.dismissPauseDays
  const pause = dismissalPause(args.existing, args.now, pauseDays)
  const checks: RecommendationReasonDto[] = [
    reason('rule_enabled', args.enabled, { ruleLabel: ruleLabel(args.ruleKey) }),
    ...args.objectChecks,
    ...(args.evaluation?.checks ?? []),
    reason('dismissed_recently', !pause.active, {
      daysAgo: pause.daysAgo,
      until: pause.until?.toISOString() ?? null,
      pauseDays,
    }),
  ]
  return {
    ruleKey: args.ruleKey,
    ruleLabel: ruleLabel(args.ruleKey),
    wouldRecommend: allPass(checks),
    checks: checks.map(
      (item): WhyNotCheckDto => ({
        ruleKey: args.ruleKey,
        check: item.code,
        pass: item.pass,
        label: item.label,
        detail: item.detail,
        facts: item.facts,
      }),
    ),
    recommendation: args.existing
      ? { id: args.existing.id, status: args.existing.status, isDeferred: args.existing.isDeferred }
      : null,
  }
}

/** Открытая рекомендация в объёме, нужном пересчёту балла. */
export interface ScoringRow {
  id: string
  ruleKey: string
  priority: Parameters<typeof scoreRecommendation>[0]['priority']
  relatedData: unknown
  reasons: unknown
}

export interface RescorePlanItem {
  id: string
  score: number
  breakdown: ReturnType<typeof scoreRecommendation>['breakdown']
  reasons: RecommendationReasonDto[]
  isDeferred: boolean
}

/**
 * Пересчёт балла открытых рекомендаций: вес правила по статистике на `now`,
 * пометки «вес правила» и «нагрузка менеджера», решение «отложить».
 * Проверки правила в причинах сохраняются как есть — меняются только пометки обучения.
 */
export function planRescore(
  rows: readonly ScoringRow[],
  scopes: ReadonlyMap<string, RecommendationScopes>,
  index: StatsIndex,
  loads: ReadonlyMap<string, ManagerLoad>,
  now: Date,
  config: LearningConfig = RECOMMENDATION_LEARNING,
  random?: Random,
): RescorePlanItem[] {
  return rows.map((row) => {
    const scope = scopes.get(row.id) ?? { universityId: null, managerId: null }
    const scored = scoreRecommendation(row, scope, index, now, config, random)
    const { p, pSource, trialsEff } = scored.breakdown
    const load = scope.managerId ? (loads.get(scope.managerId) ?? { shown: 0, done: 0 }) : null
    const overloaded = load ? isOverloaded(load, config) : false
    const isDeferred = shouldDefer(scored.score, overloaded, config)

    const learning = [
      reason('rule_weight_low', p >= config.lowRuleWeight, {
        p,
        pSource,
        trialsEff,
        threshold: config.lowRuleWeight,
        ruleLabel: ruleLabel(row.ruleKey),
      }),
      ...(load
        ? [
            reason('manager_overloaded', !isDeferred, {
              shown: load.shown,
              done: load.done,
              windowDays: config.overloadWindowDays,
              maxDoneShare: config.overloadMaxDoneShare,
              threshold: config.overloadScoreThreshold,
              overloaded,
            }),
          ]
        : []),
    ]
    const conditions = parseReasons(row.reasons).filter(
      (item) => !(LEARNING_REASON_CODES as readonly string[]).includes(item.code),
    )
    return { id: row.id, score: scored.score, breakdown: scored.breakdown, reasons: [...conditions, ...learning], isDeferred }
  })
}
