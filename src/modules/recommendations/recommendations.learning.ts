import {
  RECOMMENDATION_LEARNING,
  RECOMMENDATION_RULES,
  RECOMMENDATION_VALUE_ANCHORS,
} from '@/shared/config/analytics.config'
import type { RecommendationPriority } from '@/shared/contracts/enums'
import type { RuleStatsScopeType, RecommendationScoreDto } from '@/shared/contracts/recommendation'
import { outOf100 } from '@/shared/utils/number'

/**
 * Обучение рекомендаций на решениях сотрудников (решение 119).
 *
 * Здесь только чистая математика — без базы: затухание, вероятность полезности
 * правила, частичный пулинг, итоговый балл, доверительный интервал, защита от
 * перегрузки и пауза после отклонения. Та же математика повторена в SQL записи
 * статистики (`recommendations.stats.repo.ts`) — функция `applyEvent` здесь её
 * зеркало: по ней работает симуляция и сверяют тесты.
 *
 * Формулы и как объяснить их за минуту — docs/RECOMMENDATIONS_MODEL.md.
 */

export const DAY_MS = 24 * 60 * 60 * 1000

export type LearningConfig = typeof RECOMMENDATION_LEARNING

// ─────────────────────────── Затухание ──────────────────────────────────────

/** Коэффициент затухания за время от `from` до `to`: 0,5^(Δt / H). Время назад не течёт. */
export function decayFactor(from: Date, to: Date, halfLifeDays: number): number {
  const elapsed = Math.max(0, to.getTime() - from.getTime())
  return 0.5 ** (elapsed / (halfLifeDays * DAY_MS))
}

/** Счётчики правила на одном уровне (общий, вуз, менеджер). */
export interface RuleStatsState {
  trials: number
  successes: number
  trialsEff: number
  successesEff: number
  effUpdatedAt: Date
}

export interface RuleStatsEvent {
  at: Date
  /** Показов в событии (обычно 0 или 1; пересборка складывает показы одного уровня). */
  trials: number
  /** Успехов в событии. */
  successes: number
}

export const EMPTY_STATS: Readonly<Omit<RuleStatsState, 'effUpdatedAt'>> = {
  trials: 0,
  successes: 0,
  trialsEff: 0,
  successesEff: 0,
}

/**
 * Одно событие: eff := eff·coef + приращение. Зеркало SQL записи статистики —
 * каждая строка здесь соответствует выражению в `recordRuleEvents`.
 *
 * - `successesEff ≤ trialsEff`: успех засчитывается позже показа, и его вес
 *   ещё полный, а показ уже остыл. Поэтому показы подтягиваются до успехов
 *   (`max`) — дробные счётчики не округляются, инвариант держится точно.
 * - То же для полных счётчиков: успех по рекомендации, чей показ пришёлся на
 *   другой уровень (сменился ответственный), не делает успехов больше показов.
 * - Событие «из прошлого» (часы разошлись) не состаривает запись: момент
 *   обновления — наибольший из двух, затухание за отрицательное время — 1.
 */
export function applyEvent(
  state: RuleStatsState | null,
  event: RuleStatsEvent,
  halfLifeDays: number,
): RuleStatsState {
  if (!state) {
    const successesEff = event.successes
    return {
      trials: Math.max(event.trials, event.successes),
      successes: event.successes,
      trialsEff: Math.max(event.trials, successesEff),
      successesEff,
      effUpdatedAt: event.at,
    }
  }
  const coef = decayFactor(state.effUpdatedAt, event.at, halfLifeDays)
  const successesEff = state.successesEff * coef + event.successes
  const successes = state.successes + event.successes
  return {
    trials: Math.max(state.trials + event.trials, successes),
    successes,
    trialsEff: Math.max(state.trialsEff * coef + event.trials, successesEff),
    successesEff,
    effUpdatedAt: event.at.getTime() > state.effUpdatedAt.getTime() ? event.at : state.effUpdatedAt,
  }
}

/** Эффективные счётчики на момент `now` — «доостуженные» с последнего события. */
export interface EffectiveCounts {
  trialsEff: number
  successesEff: number
}

export function coolDown(state: RuleStatsState | null, now: Date, halfLifeDays: number): EffectiveCounts {
  if (!state) return { trialsEff: 0, successesEff: 0 }
  const coef = decayFactor(state.effUpdatedAt, now, halfLifeDays)
  return { trialsEff: state.trialsEff * coef, successesEff: state.successesEff * coef }
}

// ─────────────────────── Вероятность полезности ─────────────────────────────

/** Апостериорное распределение Beta(α, β) вероятности, что рекомендация правила окажется полезной. */
export interface BetaPosterior {
  alpha: number
  beta: number
}

export function betaMean({ alpha, beta }: BetaPosterior): number {
  return alpha / (alpha + beta)
}

/**
 * Общий уровень: равномерное априорное Beta(1, 1) — «ничего не знаем, 50 на 50».
 * Среднее (1 + s) / (2 + t): без данных ровно 0,5.
 */
export function globalPosterior(counts: EffectiveCounts): BetaPosterior {
  return {
    alpha: 1 + counts.successesEff,
    beta: 1 + Math.max(0, counts.trialsEff - counts.successesEff),
  }
}

/**
 * Частичный пулинг: априорное распределение уровня — оценка уровнем выше,
 * «весом» в k показов: Beta(k·p_parent, k·(1 − p_parent)). Среднее
 * (s + k·p_parent) / (t + k): при t ≪ k — почти общая оценка, при t ≫ k — своя.
 * Формула одна при любом объёме данных, поэтому балл не прыгает на границе
 * «мало данных / достаточно».
 */
export function pooledPosterior(counts: EffectiveCounts, parentMean: number, k: number): BetaPosterior {
  return {
    alpha: counts.successesEff + k * parentMean,
    beta: Math.max(0, counts.trialsEff - counts.successesEff) + k * (1 - parentMean),
  }
}

/** Уровни, к которым относится рекомендация: вуз объекта и ответственный менеджер связки. */
export interface RecommendationScopes {
  universityId: string | null
  managerId: string | null
}

export const GLOBAL_SCOPE_ID = 'all'

export function statsKey(ruleType: string, scopeType: RuleStatsScopeType, scopeId: string): string {
  return `${ruleType}|${scopeType}|${scopeId}`
}

export type StatsIndex = ReadonlyMap<string, RuleStatsState>

export function indexStats(
  rows: ReadonlyArray<RuleStatsState & { ruleType: string; scopeType: string; scopeId: string }>,
): Map<string, RuleStatsState> {
  const index = new Map<string, RuleStatsState>()
  for (const row of rows) {
    index.set(statsKey(row.ruleType, row.scopeType as RuleStatsScopeType, row.scopeId), row)
  }
  return index
}

/** Уровни статистики, в которые пишется событие по рекомендации: общий всегда, вуз и менеджер — если есть. */
export function scopeKeysOf(scopes: RecommendationScopes): Array<{ scopeType: RuleStatsScopeType; scopeId: string }> {
  const keys: Array<{ scopeType: RuleStatsScopeType; scopeId: string }> = [
    { scopeType: 'global', scopeId: GLOBAL_SCOPE_ID },
  ]
  if (scopes.universityId) keys.push({ scopeType: 'university', scopeId: scopes.universityId })
  if (scopes.managerId) keys.push({ scopeType: 'manager', scopeId: scopes.managerId })
  return keys
}

export type PSource = 'local' | 'pooled' | 'global'

export interface RuleProbability {
  p: number
  pSource: PSource
  /** Уровень, чьи счётчики показаны: самый узкий, по которому есть данные. */
  level: RuleStatsScopeType
  trialsEff: number
  successesEff: number
  posterior: BetaPosterior
}

/** Показы меньше этого — «данных нет вовсе»: дробные остатки давно остывших событий. */
const NO_DATA_TRIALS = 0.05

/**
 * Вероятность полезности правила для рекомендации: цепочка общий → вуз → менеджер,
 * каждый уровень пулится с предыдущим.
 *
 * `pSource`: `global` — своих данных нет (оценка общая); `pooled` — свои есть, но
 * меньше `localDataTrials` эффективных показов, общая оценка ещё перевешивает;
 * `local` — своих данных достаточно.
 */
export function ruleProbability(
  index: StatsIndex,
  ruleType: string,
  scopes: RecommendationScopes,
  now: Date,
  config: LearningConfig = RECOMMENDATION_LEARNING,
): RuleProbability {
  const H = config.halfLifeDays
  const globalCounts = coolDown(index.get(statsKey(ruleType, 'global', GLOBAL_SCOPE_ID)) ?? null, now, H)
  let posterior = globalPosterior(globalCounts)
  let shown: { level: RuleStatsScopeType; counts: EffectiveCounts } = { level: 'global', counts: globalCounts }
  let hasLocal = false

  const chain: Array<[RuleStatsScopeType, string | null]> = [
    ['university', scopes.universityId],
    ['manager', scopes.managerId],
  ]
  for (const [scopeType, scopeId] of chain) {
    if (!scopeId) continue
    const counts = coolDown(index.get(statsKey(ruleType, scopeType, scopeId)) ?? null, now, H)
    posterior = pooledPosterior(counts, betaMean(posterior), config.poolingStrength)
    if (counts.trialsEff >= NO_DATA_TRIALS) {
      hasLocal = true
      shown = { level: scopeType, counts }
    }
  }

  const pSource: PSource = !hasLocal
    ? 'global'
    : shown.counts.trialsEff >= config.localDataTrials
      ? 'local'
      : 'pooled'
  return {
    p: betaMean(posterior),
    pSource,
    level: shown.level,
    trialsEff: shown.counts.trialsEff,
    successesEff: shown.counts.successesEff,
    posterior,
  }
}

// ─────────────────────── Доверительный интервал ─────────────────────────────

/** ln Γ(x) — приближение Ланцоша (g = 7, 9 коэффициентов), точность ~1e-15. */
function lnGamma(x: number): number {
  const coefficients = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x)
  const shifted = x - 1
  let sum = coefficients[0]!
  for (let index = 1; index < coefficients.length; index += 1) sum += coefficients[index]! / (shifted + index)
  const t = shifted + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(sum)
}

/** Цепная дробь неполной бета-функции (метод Лентца). */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const TINY = 1e-300
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < TINY) d = TINY
  d = 1 / d
  let result = d
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m
    let step = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2))
    d = 1 + step * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + step / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    result *= d * c
    step = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))
    d = 1 + step * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + step / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    const delta = d * c
    result *= delta
    if (Math.abs(delta - 1) < 1e-12) break
  }
  return result
}

/** Регуляризованная неполная бета-функция I_x(a, b) — функция распределения Beta(a, b). */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(x, a, b)) / a
  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b
}

/** Квантиль Beta(a, b) — делением отрезка пополам: функция распределения монотонна. */
export function betaQuantile(q: number, a: number, b: number): number {
  let low = 0
  let high = 1
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2
    if (betaCdf(middle, a, b) < q) low = middle
    else high = middle
  }
  return (low + high) / 2
}

/** Центральный 90-процентный интервал апостериорного распределения: квантили 5 % и 95 %. */
export function credibleInterval90(posterior: BetaPosterior): [number, number] {
  return [
    betaQuantile(0.05, posterior.alpha, posterior.beta),
    betaQuantile(0.95, posterior.alpha, posterior.beta),
  ]
}

// ─────────────────────── Выборка Томпсона (за флагом) ───────────────────────

export type Random = () => number

/** Гамма-распределение Γ(shape, 1) — метод Марсальи — Цанга. */
function sampleGamma(shape: number, random: Random): number {
  if (shape < 1) return sampleGamma(shape + 1, random) * random() ** (1 / shape)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number
    let v: number
    do {
      // Нормальная величина по Боксу — Мюллеру.
      x = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = random()
    if (u < 1 - 0.0331 * x ** 4) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

/** Случайная величина из Beta(α, β): отношение двух гамма-величин. */
export function sampleBeta(posterior: BetaPosterior, random: Random): number {
  const x = sampleGamma(posterior.alpha, random)
  const y = sampleGamma(posterior.beta, random)
  return x + y === 0 ? 0.5 : x / (x + y)
}

/**
 * Генератор псевдослучайных чисел с зерном (mulberry32): одинаковое зерно —
 * одинаковая последовательность. Для симуляции и режима выборки в тестах.
 */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─────────────────────── Ценность случая и балл ─────────────────────────────

const PRIORITY_SCORE: Record<RecommendationPriority, number> = {
  CRITICAL: 1,
  HIGH: 2 / 3,
  MEDIUM: 1 / 3,
  LOW: 0,
}

export function priorityScore(priority: RecommendationPriority): number {
  return PRIORITY_SCORE[priority]
}

/** Насыщение v / (v + якорь): 0 при v = 0, 0,5 при v = якорю, стремится к 1. */
export function saturate(value: number, anchor: number): number {
  if (!(value > 0)) return 0
  return value / (value + anchor)
}

export interface CaseValue {
  /** Величина случая: дни просрочки, спрос, число пустых показателей… */
  value: number
  anchor: number
  /** Что это за число — для разбора балла. */
  label: string
}

function numberOf(data: Record<string, unknown>, key: string): number {
  const value = Number(data[key])
  return Number.isFinite(value) ? value : 0
}

/**
 * Ценность случая по каждому правилу — из `relatedData`, которое правило уже
 * сохраняет. Балл поэтому пересчитывается без повторного прогона правил.
 */
export function caseValue(ruleKey: string, relatedData: unknown): CaseValue {
  const data =
    relatedData !== null && typeof relatedData === 'object' && !Array.isArray(relatedData)
      ? (relatedData as Record<string, unknown>)
      : {}
  switch (ruleKey) {
    case 'stage.overdue':
      return { value: numberOf(data, 'daysOverdue'), anchor: RECOMMENDATION_VALUE_ANCHORS.overdueDays, label: 'дней просрочки' }
    case 'cooperation.stalled':
      return { value: numberOf(data, 'idleDays'), anchor: RECOMMENDATION_VALUE_ANCHORS.stalledIdleDays, label: 'дней без движения' }
    case 'skill.critical-gap-with-product':
      return {
        value: outOf100(numberOf(data, 'demandNormalized')),
        anchor: RECOMMENDATION_VALUE_ANCHORS.gapDemand,
        label: 'спрос на навык из 100',
      }
    case 'program.missing-metrics':
      return {
        value: Array.isArray(data.missing) ? data.missing.length : 0,
        anchor: RECOMMENDATION_VALUE_ANCHORS.missingMetrics,
        label: 'пустых показателей из 3',
      }
    case 'cooperation.no-product':
      return {
        value: Math.max(0, numberOf(data, 'currentStageNumber') - RECOMMENDATION_RULES.productRequiredFromStage + 1),
        anchor: RECOMMENDATION_VALUE_ANCHORS.noProductStages,
        label: 'этапов оформления без продукта',
      }
    default:
      return { value: 0, anchor: 1, label: 'нет меры ценности' }
  }
}

export interface ScoreInput {
  p: number
  value: number
  anchor: number
  priority: RecommendationPriority
}

/**
 * Итоговый балл в [0..1]: 0,5·p + 0,35·v/(v + якорь) + 0,15·приоритет.
 * Каждая часть в [0..1], веса в сумме 1 — балл не выходит за [0..1] и не убывает
 * ни по одной части.
 */
export function computeScore(input: ScoreInput, config: LearningConfig = RECOMMENDATION_LEARNING): number {
  const p = Math.min(1, Math.max(0, input.p))
  return (
    config.scoreWeightRule * p +
    config.scoreWeightValue * saturate(input.value, input.anchor) +
    config.scoreWeightPriority * priorityScore(input.priority)
  )
}

// ─────────────────────── Перегрузка и пауза ─────────────────────────────────

export interface ManagerLoad {
  shown: number
  done: number
}

/** Менеджер перегружен: за окно показов много, а выполнено меньше заданной доли. */
export function isOverloaded(load: ManagerLoad, config: LearningConfig = RECOMMENDATION_LEARNING): boolean {
  if (load.shown < config.overloadMinShown) return false
  return load.done / load.shown < config.overloadMaxDoneShare
}

/** Отложить рекомендацию перегруженного менеджера: балл ниже порога. Не удаляется — стоит в конце ленты. */
export function shouldDefer(
  score: number,
  overloaded: boolean,
  config: LearningConfig = RECOMMENDATION_LEARNING,
): boolean {
  return overloaded && score < config.overloadScoreThreshold
}

export interface DismissalPause {
  active: boolean
  /** Когда пауза кончается; null — рекомендация не отклонена. */
  until: Date | null
  daysAgo: number | null
}

/**
 * Пауза после отклонения: то же правило по тому же объекту не создаётся
 * и не открывается снова `dismissPauseDays` дней после решения сотрудника.
 */
export function dismissalPause(
  row: { status: string; resolvedAt: Date | null } | null,
  now: Date,
  pauseDays: number = RECOMMENDATION_LEARNING.dismissPauseDays,
): DismissalPause {
  if (!row || row.status !== 'DISMISSED' || !row.resolvedAt) return { active: false, until: null, daysAgo: null }
  const until = new Date(row.resolvedAt.getTime() + pauseDays * DAY_MS)
  return {
    active: now.getTime() < until.getTime(),
    until,
    daysAgo: Math.floor((now.getTime() - row.resolvedAt.getTime()) / DAY_MS),
  }
}

/** Отклонённая, чья пауза кончилась, а правило снова её выдаёт, — открывается как новый показ. */
export function isPauseOver(
  row: { status: string; resolvedAt: Date | null },
  now: Date,
  pauseDays: number = RECOMMENDATION_LEARNING.dismissPauseDays,
): boolean {
  const pause = dismissalPause(row, now, pauseDays)
  return row.status === 'DISMISSED' && pause.until !== null && !pause.active
}

// ─────────────────────── Разбор балла одной рекомендации ────────────────────

export interface ScoredRecommendation {
  score: number
  breakdown: RecommendationScoreDto
}

/**
 * Балл рекомендации и его разбор — одна функция для пересборки, пересчёта после
 * решения сотрудника и симуляции. `random` задан — вес правила берётся выборкой
 * Томпсона (режим `sampling: 'thompson'`), иначе средним.
 */
export function scoreRecommendation(
  row: { ruleKey: string; relatedData: unknown; priority: RecommendationPriority },
  scopes: RecommendationScopes,
  index: StatsIndex,
  now: Date,
  config: LearningConfig = RECOMMENDATION_LEARNING,
  random?: Random,
): ScoredRecommendation {
  const probability = ruleProbability(index, row.ruleKey, scopes, now, config)
  const sampled = config.sampling === 'thompson' && random !== undefined
  const p = sampled ? sampleBeta(probability.posterior, random) : probability.p
  const value = caseValue(row.ruleKey, row.relatedData)
  const score = computeScore({ p, value: value.value, anchor: value.anchor, priority: row.priority }, config)
  return {
    score,
    breakdown: {
      p,
      pSource: probability.pSource,
      pLevel: probability.level,
      sampling: sampled ? 'thompson' : 'mean',
      trialsEff: probability.trialsEff,
      successesEff: probability.successesEff,
      value: value.value,
      valueLabel: value.label,
      valueAnchor: value.anchor,
      valueScore: saturate(value.value, value.anchor),
      priority: priorityScore(row.priority),
      weights: {
        rule: config.scoreWeightRule,
        value: config.scoreWeightValue,
        priority: config.scoreWeightPriority,
      },
      score,
    },
  }
}
