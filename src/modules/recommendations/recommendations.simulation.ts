import { RECOMMENDATION_LEARNING } from '@/shared/config/analytics.config'
import {
  DAY_MS,
  applyEvent,
  ruleProbability,
  scopeKeysOf,
  seededRandom,
  statsKey,
  type LearningConfig,
  type RecommendationScopes,
  type RuleStatsState,
} from './recommendations.learning'
import type { RuleStatsScopeType } from '@/shared/contracts/recommendation'

/**
 * Модель решений менеджеров (решение 119) — для `npm run recs:simulate` и истории
 * статистики в демо-данных. Чистая функция с зерном: одно зерно — одни и те же цифры.
 *
 * Каждый «кандидат» — пара правило × объект. Правило выдаёт рекомендацию, менеджер
 * через 1–4 дня решает: выполнить (с вероятностью правила) или отклонить. После
 * выполнения проблема возвращается через 1–3 недели, после отклонения — пауза
 * `dismissPauseDays`. События проходят через ту же арифметику, что и SQL (`applyEvent`).
 */

export interface SimulationCandidate {
  ruleKey: string
  scopes: RecommendationScopes
}

export interface SimulationEvent {
  kind: 'show' | 'success'
  ruleKey: string
  scopeType: RuleStatsScopeType
  scopeId: string
  at: Date
}

export interface SimulationSnapshot {
  day: number
  /** Вес каждого правила на общем уровне в этот день. */
  weights: Record<string, number>
  trialsEff: Record<string, number>
}

export interface SimulationResult {
  events: SimulationEvent[]
  snapshots: SimulationSnapshot[]
  /** Итог по правилам: показано, выполнено, отклонено. */
  totals: Record<string, { shown: number; done: number; dismissed: number }>
  state: Map<string, RuleStatsState>
}

/**
 * Вероятность, что менеджер выполнит рекомендацию правила. Застой систематически
 * отклоняют: «связка без движения» часто — пауза по просьбе вуза, а не проблема.
 */
export const DEFAULT_ACCEPT_RATES: Record<string, number> = {
  'stage.overdue': 0.75,
  'skill.critical-gap-with-product': 0.55,
  'cooperation.no-product': 0.65,
  'program.missing-metrics': 0.6,
  'cooperation.stalled': 0.1,
}

export function simulateDecisions(options: {
  candidates: readonly SimulationCandidate[]
  days: number
  start: Date
  seed: number
  acceptRates?: Record<string, number>
  snapshotEvery?: number
  /** Сколько последних дней новых показов нет — только решения по уже показанным. */
  quietTailDays?: number
  config?: LearningConfig
}): SimulationResult {
  const config = options.config ?? RECOMMENDATION_LEARNING
  const rates = options.acceptRates ?? DEFAULT_ACCEPT_RATES
  const random = seededRandom(options.seed)
  const every = options.snapshotEvery ?? 7
  const dayAt = (day: number, hour = 10) => new Date(options.start.getTime() + day * DAY_MS + hour * 3_600_000)

  const state = new Map<string, RuleStatsState>()
  const events: SimulationEvent[] = []
  const totals: SimulationResult['totals'] = {}
  const rules = [...new Set(options.candidates.map((item) => item.ruleKey))]
  for (const rule of rules) totals[rule] = { shown: 0, done: 0, dismissed: 0 }

  const record = (kind: 'show' | 'success', candidate: SimulationCandidate, at: Date) => {
    for (const key of scopeKeysOf(candidate.scopes)) {
      const id = statsKey(candidate.ruleKey, key.scopeType, key.scopeId)
      state.set(
        id,
        applyEvent(state.get(id) ?? null, { at, trials: kind === 'show' ? 1 : 0, successes: kind === 'success' ? 1 : 0 }, config.halfLifeDays),
      )
      events.push({ kind, ruleKey: candidate.ruleKey, ...key, at })
    }
  }

  // Первые показы разнесены по первой неделе — иначе все правила стартовали бы в один день.
  const tracks = options.candidates.map((candidate) => ({
    candidate,
    nextShow: Math.floor(random() * 7),
    decideOn: -1,
  }))

  const snapshots: SimulationSnapshot[] = []
  const snapshot = (day: number) => {
    const weights: Record<string, number> = {}
    const trialsEff: Record<string, number> = {}
    for (const rule of rules) {
      const probability = ruleProbability(state, rule, { universityId: null, managerId: null }, dayAt(day, 23))
      weights[rule] = probability.p
      trialsEff[rule] = probability.trialsEff
    }
    snapshots.push({ day, weights, trialsEff })
  }

  // Внутри дня — сначала все решения (10:00), потом все показы (16:00): события
  // идут строго по времени, как их запишет база, и затухание считается одинаково.
  for (let day = 0; day < options.days; day += 1) {
    if (day % every === 0) snapshot(day)
    for (const track of tracks) {
      if (track.decideOn !== day) continue
      const accepted = random() < (rates[track.candidate.ruleKey] ?? 0.5)
      if (accepted) {
        record('success', track.candidate, dayAt(day, 10))
        totals[track.candidate.ruleKey]!.done += 1
        track.nextShow = day + 7 + Math.floor(random() * 15)
      } else {
        totals[track.candidate.ruleKey]!.dismissed += 1
        track.nextShow = day + config.dismissPauseDays
      }
      track.decideOn = -1
    }
    if (day >= options.days - (options.quietTailDays ?? 0)) continue
    for (const track of tracks) {
      if (track.decideOn !== -1 || day < track.nextShow) continue
      record('show', track.candidate, dayAt(day, 16))
      totals[track.candidate.ruleKey]!.shown += 1
      track.decideOn = day + 1 + Math.floor(random() * 4)
      track.nextShow = Number.POSITIVE_INFINITY
    }
  }
  snapshot(options.days)
  return { events, snapshots, totals, state }
}

/**
 * Кандидаты для модели, когда базы под рукой нет: по несколько объектов на правило,
 * два вуза и два менеджера.
 */
export function syntheticCandidates(): SimulationCandidate[] {
  const scopes: RecommendationScopes[] = [
    { universityId: 'u-1', managerId: 'm-1' },
    { universityId: 'u-2', managerId: 'm-2' },
    { universityId: 'u-1', managerId: 'm-2' },
  ]
  return Object.keys(DEFAULT_ACCEPT_RATES).flatMap((ruleKey) =>
    scopes.map((scope) =>
      ruleKey === 'skill.critical-gap-with-product'
        ? { ruleKey, scopes: { universityId: null, managerId: null } }
        : ruleKey === 'program.missing-metrics'
          ? { ruleKey, scopes: { universityId: scope.universityId, managerId: null } }
          : { ruleKey, scopes: scope },
    ),
  )
}
