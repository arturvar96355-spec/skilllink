/**
 * Длительность этапов по Каплану–Мейеру (решение 120, docs/ANALYTICS_MODEL.md).
 *
 * Чистый модуль: ни базы, ни даты «сейчас». На вход — наблюдения «сколько дней
 * связка была на этапе и вышла ли из него», на выход — кривая «доля прошедших
 * этап к дню t» с 95% интервалом, медиана и p90.
 *
 * Зачем не простое среднее. Связки, которые ещё на этапе, нельзя ни выбросить
 * (останутся только быстрые — оценка занижена), ни посчитать «прошедшими сегодня»
 * (оценка тоже занижена). Каплан–Мейер учитывает их честно: «прошла не меньше
 * N дней» — это цензурированное наблюдение, оно участвует в риске до своего дня
 * и дальше выбывает, не будучи событием.
 *
 * Формулы (по дням, t — дни с событиями по возрастанию):
 *   n(t) — сколько наблюдений ещё «под риском»: длительность ≥ t;
 *   d(t) — сколько вышли из этапа ровно в день t;
 *   S(t) = Π (1 − d/n)                       доля ещё не прошедших;
 *   G(t) = Σ d / (n·(n − d))                 сумма Гринвуда;
 *   SE(t) = S(t)·√G(t);   F(t) = 1 − S(t);   95%: F ± 1,96·SE, обрезано в [0, 1].
 * Ничьи: события и цензура в один день — цензурированные в этот день ещё под
 * риском (стандартное соглашение). Когда n = d, S обнуляется, слагаемое Гринвуда
 * не определено и не добавляется: SE = S·√G = 0.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Наблюдение: длительность в целых днях и было ли событие (выход из этапа вперёд). */
export interface SurvivalObservation {
  days: number
  /** true — связка перешла дальше (событие); false — ещё на этапе, пауза или отмена (цензура). */
  event: boolean
}

/** Шаг оценки в день, когда были события. */
export interface KmStep {
  day: number
  atRisk: number
  events: number
  censored: number
  /** S(t) — доля ещё не прошедших этап. */
  survival: number
  /** Накопленная сумма Гринвуда. */
  greenwood: number
  se: number
  /** F(t) = 1 − S(t) — доля прошедших этап к дню t. */
  F: number
  lo: number
  hi: number
}

export interface KmCurvePoint {
  day: number
  F: number
  lo: number
  hi: number
}

export interface KmEstimate {
  n: number
  events: number
  censored: number
  steps: KmStep[]
  /** Ступенчатая кривая для графика: начинается с дня 0 (F = 0), затем по шагам. */
  curve: KmCurvePoint[]
}

export interface QuantileEstimate {
  /** Первый день, когда F ≥ q; null — кривая до q не дошла. */
  day: number | null
  /**
   * Интервал для дня квантиля — обращение поточечной полосы: нижняя граница —
   * первый день, где верх полосы ≥ q; верхняя — первый день, где низ полосы ≥ q.
   * null — полоса до q не дошла (граница неизвестна, «больше наблюдаемого»).
   */
  ci: { low: number | null; high: number | null }
}

export interface SurvivalOptions {
  /** Множитель интервала: 1,96 — 95%. */
  z: number
  minObservations: number
  minEvents: number
  /** Квантиль порога «застряло». */
  stalledQuantile: number
}

/** Значения по умолчанию — те же, что в конфиге (STALLED_THRESHOLD). */
export const KM_DEFAULTS: SurvivalOptions = {
  z: 1.96,
  minObservations: 30,
  minEvents: 15,
  stalledQuantile: 0.9,
}

/** Погрешность сравнения долей: 0,5 из суммы произведений не должно стать 0,4999999. */
const EPSILON = 1e-9

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * Длительность в целых днях. Событие в течение дня t засчитывается днём t
 * (вверх: 5,2 дня → 6-й день); цензура — полными прожитыми днями (вниз:
 * 5,9 дня → «не меньше 5»). Отрицательное (часы разъехались) — 0.
 */
export function durationDays(fromMs: number, toMs: number, event: boolean): number {
  const raw = Math.max(0, (toMs - fromMs) / DAY_MS)
  return Math.max(0, event ? Math.ceil(raw - EPSILON) : Math.floor(raw + EPSILON))
}

/** Оценка Каплана–Мейера с дисперсией Гринвуда. */
export function kaplanMeier(
  observations: readonly SurvivalObservation[],
  z: number = KM_DEFAULTS.z,
): KmEstimate {
  const valid = observations.filter((item) => Number.isFinite(item.days) && item.days >= 0)
  const byDay = new Map<number, { events: number; censored: number }>()
  for (const item of valid) {
    const day = Math.floor(item.days)
    const bucket = byDay.get(day) ?? { events: 0, censored: 0 }
    if (item.event) bucket.events += 1
    else bucket.censored += 1
    byDay.set(day, bucket)
  }
  const days = [...byDay.keys()].sort((a, b) => a - b)

  let atRisk = valid.length
  let survival = 1
  let greenwood = 0
  const steps: KmStep[] = []
  for (const day of days) {
    const { events, censored } = byDay.get(day)!
    if (events > 0) {
      survival *= 1 - events / atRisk
      if (atRisk - events > 0) greenwood += events / (atRisk * (atRisk - events))
      const se = survival * Math.sqrt(greenwood)
      const F = 1 - survival
      steps.push({
        day,
        atRisk,
        events,
        censored,
        survival,
        greenwood,
        se,
        F,
        lo: clamp01(F - z * se),
        hi: clamp01(F + z * se),
      })
    }
    atRisk -= events + censored
  }

  const curve: KmCurvePoint[] = []
  if (steps[0]?.day !== 0) curve.push({ day: 0, F: 0, lo: 0, hi: 0 })
  for (const step of steps) curve.push({ day: step.day, F: step.F, lo: step.lo, hi: step.hi })

  const events = valid.filter((item) => item.event).length
  return { n: valid.length, events, censored: valid.length - events, steps, curve }
}

/** День, к которому этап проходит доля q связок, и интервал для него. */
export function quantileDay(estimate: KmEstimate, q: number): QuantileEstimate {
  const first = (pick: (step: KmStep) => number) =>
    estimate.steps.find((step) => pick(step) >= q - EPSILON)?.day ?? null
  return {
    day: first((step) => step.F),
    ci: { low: first((step) => step.hi), high: first((step) => step.lo) },
  }
}

export type DurationStatus = 'ok' | 'insufficient_data'

/** Сводка длительности одного этапа — то, что отдаёт API и читает порог застоя. */
export interface DurationSummary {
  status: DurationStatus
  n: number
  events: number
  censored: number
  /** Медиана — «нормальное время этапа»: день, к которому этап проходит половина связок. */
  median: QuantileEstimate
  /** Квантиль порога «застряло» (по умолчанию p90). */
  p90: QuantileEstimate
  curve: KmCurvePoint[]
}

/** Хватает ли наблюдений, чтобы оценке верить. */
export function hasEnoughData(
  estimate: Pick<KmEstimate, 'n' | 'events'>,
  options: Pick<SurvivalOptions, 'minObservations' | 'minEvents'> = KM_DEFAULTS,
): boolean {
  return estimate.n >= options.minObservations && estimate.events >= options.minEvents
}

/**
 * Полная сводка по наблюдениям этапа. Кривая и квантили считаются всегда (их можно
 * показать с пометкой), а `status` говорит, можно ли на них опираться: меньше
 * минимума — `insufficient_data`, и порог застоя остаётся ручным.
 */
export function summarizeDurations(
  observations: readonly SurvivalObservation[],
  options: Partial<SurvivalOptions> = {},
): DurationSummary {
  const settings = { ...KM_DEFAULTS, ...options }
  const estimate = kaplanMeier(observations, settings.z)
  return {
    status: hasEnoughData(estimate, settings) ? 'ok' : 'insufficient_data',
    n: estimate.n,
    events: estimate.events,
    censored: estimate.censored,
    median: quantileDay(estimate, 0.5),
    p90: quantileDay(estimate, settings.stalledQuantile),
    curve: estimate.curve,
  }
}
