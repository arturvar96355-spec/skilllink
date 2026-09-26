import { afterEach, describe, expect, it } from 'vitest'
import type { StageStatus } from '@/shared/contracts/enums'
import { RECOMMENDATION_RULES } from '@/shared/config/analytics.config'
import {
  durationDays,
  kaplanMeier,
  quantileDay,
  summarizeDurations,
  type SurvivalObservation,
} from './survival'
import {
  buildStageTimeline,
  stageObservation,
  type TimelineCooperationInput,
} from './stage-timeline'
import { buildCohorts, buildFunnel, MILESTONE_STEPS, STAGE_STEPS, type FunnelSubject } from './funnel'
import {
  ANOMALY_DAILY,
  ANOMALY_WEEKLY,
  contributions,
  dailyCounts,
  decomposeChange,
  detectAnomaly,
  explainingSlices,
  isAnomaly,
  sampleSd,
  weeklyCounts,
} from './anomaly'
import {
  getStalledThreshold,
  resetStageDurations,
  setStageDurations,
  thresholdFrom,
} from './stalled-threshold'
import { buildInsights, dailyWindows, type InsightContext, type SeriesPoint } from './insights'
import { buildPulse, toPulseDto } from './pulse.rules'
import {
  evaluateCooperation,
  ruleStalledCooperation,
  stalledDaysThreshold,
  type CooperationRuleInput,
} from '@/modules/recommendations/recommendations.rules'

/**
 * Аналитика этапов (решение 120): формулы проверяются на примерах, посчитанных
 * вручную, — числа в ожиданиях выписаны из расчёта в комментарии, а не из кода.
 */

const DAY = 24 * 60 * 60 * 1000
const obs = (days: number, event: boolean): SurvivalObservation => ({ days, event })

describe('Каплан–Мейер', () => {
  /*
   * Ручной пример: 8 наблюдений, ничьи и цензура в один день.
   *   события: 2, 3, 3, 5, 8;  цензура: 3, 6, 9.
   * t=2: n=8, d=1 → S = 7/8 = 0,875;           G = 1/(8·7) = 1/56
   * t=3: n=7 (цензура в день 3 ещё под риском), d=2
   *      → S = 0,875·5/7 = 0,625;              G += 2/(7·5) → 21/280 = 0,075
   * t=5: n=4, d=1 → S = 0,625·3/4 = 0,46875;   G += 1/12 → 0,158333…
   * t=8: n=2, d=1 → S = 0,234375;              G += 1/2 → 0,658333…
   * F = 1 − S: 0,125; 0,375; 0,53125; 0,765625. Медиана — день 5, p90 не достигнут.
   */
  const sample = [
    obs(2, true),
    obs(3, true),
    obs(3, true),
    obs(3, false),
    obs(5, true),
    obs(6, false),
    obs(8, true),
    obs(9, false),
  ]

  it('шаги S(t), F(t) и число под риском сходятся с ручным расчётом', () => {
    const km = kaplanMeier(sample)
    expect(km.n).toBe(8)
    expect(km.events).toBe(5)
    expect(km.censored).toBe(3)
    expect(km.steps.map((step) => step.day)).toEqual([2, 3, 5, 8])
    expect(km.steps.map((step) => step.atRisk)).toEqual([8, 7, 4, 2])
    expect(km.steps.map((step) => step.survival)).toEqual([0.875, 0.625, 0.46875, 0.234375])
    expect(km.steps.map((step) => step.F)).toEqual([0.125, 0.375, 0.53125, 0.765625])
  })

  it('дисперсия Гринвуда и SE = S·√G', () => {
    const km = kaplanMeier(sample)
    expect(km.steps[0]!.greenwood).toBeCloseTo(1 / 56, 12)
    expect(km.steps[1]!.greenwood).toBeCloseTo(0.075, 12)
    expect(km.steps[2]!.greenwood).toBeCloseTo(0.075 + 1 / 12, 12)
    expect(km.steps[3]!.greenwood).toBeCloseTo(0.075 + 1 / 12 + 0.5, 12)
    // SE(3) = 0,625·√0,075 = 0,171163…
    expect(km.steps[1]!.se).toBeCloseTo(0.625 * Math.sqrt(0.075), 12)
    expect(km.steps[1]!.se).toBeCloseTo(0.171163, 5)
    // 95%: F ± 1,96·SE, обрезано в [0, 1]
    expect(km.steps[1]!.lo).toBeCloseTo(0.375 - 1.96 * 0.171163, 5)
    expect(km.steps[1]!.hi).toBeCloseTo(0.375 + 1.96 * 0.171163, 5)
    expect(km.steps[0]!.lo).toBe(0)
  })

  it('медиана — первый день F ≥ 0,5; p90 не достигнут — null; интервал медианы', () => {
    const km = kaplanMeier(sample)
    const median = quantileDay(km, 0.5)
    expect(median.day).toBe(5)
    // Верх полосы в день 3: 0,375 + 1,96·0,171 = 0,71 ≥ 0,5 — нижняя граница 3.
    // Низ полосы до 0,5 не дошёл (в день 8 — 0,39) — верхняя граница неизвестна.
    expect(median.ci).toEqual({ low: 3, high: null })
    expect(quantileDay(km, 0.9).day).toBeNull()
  })

  it('кривая начинается с дня 0 и повторяет шаги', () => {
    const km = kaplanMeier(sample)
    expect(km.curve[0]).toEqual({ day: 0, F: 0, lo: 0, hi: 0 })
    expect(km.curve.slice(1).map((point) => point.F)).toEqual([0.125, 0.375, 0.53125, 0.765625])
  })

  it('все под риском вышли в один день: S = 0, SE = 0 (слагаемое Гринвуда не определено)', () => {
    const km = kaplanMeier([obs(4, true), obs(4, true)])
    expect(km.steps[0]!.survival).toBe(0)
    expect(km.steps[0]!.se).toBe(0)
    expect(km.steps[0]!.F).toBe(1)
    expect(quantileDay(km, 0.9).day).toBe(4)
  })

  it('только цензура — шагов нет, квантилей нет', () => {
    const km = kaplanMeier([obs(3, false), obs(10, false)])
    expect(km.steps).toEqual([])
    expect(quantileDay(km, 0.5)).toEqual({ day: null, ci: { low: null, high: null } })
  })

  it('без цензуры КМ совпадает с эмпирической долей', () => {
    const km = kaplanMeier([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((day) => obs(day, true)))
    expect(km.steps.map((step) => step.F)).toEqual(
      [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((value) => expect.closeTo(value, 12)),
    )
    expect(quantileDay(km, 0.5).day).toBe(5)
    expect(quantileDay(km, 0.9).day).toBe(9)
  })

  it('дни: событие — вверх, цензура — вниз', () => {
    expect(durationDays(0, 5.2 * DAY, true)).toBe(6)
    expect(durationDays(0, 5.9 * DAY, false)).toBe(5)
    expect(durationDays(0, 5 * DAY, true)).toBe(5)
    expect(durationDays(10 * DAY, 0, true)).toBe(0)
  })

  it('insufficient_data: меньше 30 наблюдений или 15 событий', () => {
    const many = (count: number, events: number) =>
      Array.from({ length: count }, (_, index) => obs(index + 1, index < events))
    expect(summarizeDurations(many(29, 29)).status).toBe('insufficient_data')
    expect(summarizeDurations(many(40, 14)).status).toBe('insufficient_data')
    const ok = summarizeDurations(many(30, 15))
    expect(ok.status).toBe('ok')
    expect(ok.n).toBe(30)
    expect(ok.events).toBe(15)
    expect(ok.censored).toBe(15)
  })
})

// ───────────────────────────── Хронология ────────────────────────────────────

const T0 = new Date('2026-01-10T09:00:00Z')
const at = (days: number) => new Date(T0.getTime() + days * DAY)

function cooperation(
  closes: Array<[stage: number, day: number, status?: StageStatus]>,
  overrides: Partial<TimelineCooperationInput> = {},
): TimelineCooperationInput {
  const stages = Array.from({ length: 13 }, (_, index) => {
    const number = index + 1
    const history = closes
      .filter(([stage]) => stage === number)
      .map(([, day, status]) => ({ toStatus: status ?? ('COMPLETED' as StageStatus), changedAt: at(day) }))
    const last = history.at(-1)
    return {
      stageNumber: number,
      status: last?.toStatus ?? ('NOT_STARTED' as StageStatus),
      completedAt: last?.toStatus === 'COMPLETED' ? last.changedAt : null,
      history,
    }
  })
  return {
    id: 'c1',
    status: 'ACTIVE',
    startedAt: T0,
    createdAt: T0,
    closedAt: null,
    updatedAt: T0,
    stages,
    ...overrides,
  }
}

describe('хронология текущего этапа', () => {
  const now = at(100)

  it('переходы по закрытию этапов, событие и цензура', () => {
    const timeline = buildStageTimeline(cooperation([[1, 3], [2, 10]]), now)
    expect(timeline.transitions.map((item) => [item.from, item.to])).toEqual([[1, 2], [2, 3]])
    expect(stageObservation(timeline, 1)).toEqual({ days: 3, event: true })
    expect(stageObservation(timeline, 2)).toEqual({ days: 7, event: true })
    // На этапе 3 с дня 10 до «сейчас» (день 100): цензура 90 дней.
    expect(stageObservation(timeline, 3)).toEqual({ days: 90, event: false })
    expect(stageObservation(timeline, 4)).toBeNull()
    expect(timeline.maxReached).toBe(3)
  })

  it('параллельно закрытые этапы — прыжок: перепрыгнутые не наблюдаются', () => {
    // Этапы 5 и 6 закрыли раньше, чем 4: после закрытия 4 текущий сразу 7.
    const timeline = buildStageTimeline(
      cooperation([[1, 1], [2, 2], [3, 3], [5, 4], [6, 5], [4, 20]]),
      now,
    )
    expect(timeline.transitions.at(-1)).toMatchObject({ from: 4, to: 7 })
    expect(stageObservation(timeline, 4)).toEqual({ days: 17, event: true })
    expect(stageObservation(timeline, 5)).toBeNull()
    expect(timeline.reachedAt.get(6)).toEqual(at(20))
    expect(timeline.maxReached).toBe(7)
  })

  it('отменённый этап закрывает его, как завершённый', () => {
    const timeline = buildStageTimeline(cooperation([[1, 2, 'CANCELLED']]), now)
    expect(timeline.current).toBe(2)
  })

  it('закрытие без записи истории берётся из completedAt', () => {
    const input = cooperation([])
    const stages = [...input.stages]
    stages[0] = { stageNumber: 1, status: 'COMPLETED', completedAt: at(4), history: [] }
    expect(stageObservation(buildStageTimeline({ ...input, stages }, now), 1)).toEqual({ days: 4, event: true })
  })

  it('переоткрытие предыдущего этапа — не выход: время на этапе идёт с первого входа', () => {
    const timeline = buildStageTimeline(
      cooperation([[1, 2], [2, 5], [1, 6, 'IN_PROGRESS'], [1, 8], [3, 12]]),
      now,
    )
    // Этап 3: вошли в день 5, откатились на 1 в день 6, вернулись в день 8, вышли в день 12.
    expect(stageObservation(timeline, 3)).toEqual({ days: 7, event: true })
    expect(stageObservation(timeline, 1)).toEqual({ days: 2, event: true })
  })

  it('цензура: пауза — последнее движение, отмена — дата закрытия', () => {
    const paused = buildStageTimeline(
      cooperation([[1, 2]], { status: 'PAUSED', updatedAt: at(30) }),
      now,
    )
    expect(stageObservation(paused, 2)).toEqual({ days: 28, event: false })
    const cancelled = buildStageTimeline(
      cooperation([[1, 2]], { status: 'CANCELLED', closedAt: at(12), updatedAt: at(12) }),
      now,
    )
    expect(stageObservation(cancelled, 2)).toEqual({ days: 10, event: false })
  })

  it('все 1–13 закрыты — дошла до 14', () => {
    const closes = Array.from({ length: 13 }, (_, index) => [index + 1, index + 1] as [number, number])
    const timeline = buildStageTimeline(cooperation(closes), now)
    expect(timeline.current).toBe(14)
    expect(timeline.maxReached).toBe(14)
    expect(stageObservation(timeline, 13)).toEqual({ days: 1, event: true })
  })
})

// ─────────────────────────────── Воронка ────────────────────────────────────

describe('воронка и когорты', () => {
  const now = at(200)
  const subject = (
    id: string,
    closes: Array<[number, number, StageStatus?]>,
    status: TimelineCooperationInput['status'] = 'ACTIVE',
    extra: Partial<TimelineCooperationInput> = {},
    group: FunnelSubject['group'] = null,
  ): FunnelSubject => ({
    timeline: buildStageTimeline(cooperation(closes, { id, status, ...extra }), now),
    title: `Связка ${id}`,
    status,
    group,
  })

  const subjects = [
    subject('a', [[1, 5], [2, 10], [3, 20]], 'ACTIVE', {}, { key: 'msk', label: 'Москва' }),
    subject('b', [[1, 3]], 'CANCELLED', { closedAt: at(40), updatedAt: at(40) }, { key: 'msk', label: 'Москва' }),
    subject('c', [], 'PAUSED', { updatedAt: at(15) }, { key: 'spb', label: 'Санкт-Петербург' }),
    subject('d', [[1, 1], [2, 2]], 'ACTIVE', {}, { key: 'spb', label: 'Санкт-Петербург' }),
  ]

  it('шаги идут по порядку этапов, дошедшие не растут от шага к шагу', () => {
    const funnel = buildFunnel(subjects, STAGE_STEPS)
    expect(funnel.steps.map((step) => step.fromStage)).toEqual(STAGE_STEPS.map((step) => step.fromStage))
    expect(funnel.steps.slice(0, 5).map((step) => step.reached)).toEqual([4, 3, 2, 1, 0])
    for (let index = 1; index < funnel.steps.length; index += 1) {
      expect(funnel.steps[index]!.reached).toBeLessThanOrEqual(funnel.steps[index - 1]!.reached)
    }
  })

  it('конверсии от предыдущего и от начала, медиана перехода', () => {
    const funnel = buildFunnel(subjects, STAGE_STEPS)
    expect(funnel.steps[0]!.conversionFromPrevious).toBeNull()
    expect(funnel.steps[1]!.conversionFromPrevious).toBe(3 / 4)
    expect(funnel.steps[2]!.conversionFromStart).toBe(2 / 4)
    // Этап 1 → 2: 5, 3 и 1 день — медиана 3.
    expect(funnel.steps[1]!.medianDaysFromPrevious).toBe(3)
  })

  it('отвалившиеся — на том шаге, дальше которого не прошли, со статусом', () => {
    const funnel = buildFunnel(subjects, STAGE_STEPS)
    expect(funnel.steps[0]!.dropped).toEqual([{ cooperationId: 'c', title: 'Связка c', status: 'PAUSED' }])
    expect(funnel.steps[1]!.dropped).toEqual([{ cooperationId: 'b', title: 'Связка b', status: 'CANCELLED' }])
    expect(funnel.steps[1]!.droppedCount).toBe(1)
    // В работе сейчас: a — на этапе 4, d — на этапе 3.
    expect(funnel.steps[3]!.inProgress).toBe(1)
    expect(funnel.steps[2]!.inProgress).toBe(1)
  })

  it('вехи вместо этапов и разрез по признаку', () => {
    const funnel = buildFunnel(subjects, MILESTONE_STEPS)
    expect(funnel.steps.map((step) => step.key)).toEqual(MILESTONE_STEPS.map((step) => step.key))
    expect(funnel.steps[1]!.reached).toBe(1) // до этапа 4 дошла только a
    expect(funnel.groups.map((group) => [group.label, group.total])).toEqual([
      ['Москва', 2],
      ['Санкт-Петербург', 2],
    ])
  })

  it('когорты: квартал старта, доля дошедших к концу квартала, будущих кварталов нет', () => {
    const signed = (id: string, day: number, start: Date): FunnelSubject['timeline'] =>
      buildStageTimeline(
        cooperation(
          Array.from({ length: 6 }, (_, index) => [index + 1, day] as [number, number]),
          { id, startedAt: start, createdAt: start },
        ),
        new Date('2026-09-25T00:00:00Z'),
      )
    const start = new Date('2026-01-15T09:00:00Z')
    const timelines = [
      signed('x', 10, start), // договор в январе — Q1
      signed('y', 120, start), // день 120 от 10.01 — май, Q2
      buildStageTimeline(cooperation([], { id: 'z', startedAt: start, createdAt: start }), new Date('2026-09-25T00:00:00Z')),
    ]
    const [cohort] = buildCohorts(timelines, 7, new Date('2026-09-25T00:00:00Z'))
    expect(cohort!.cohort).toBe('2026-Q1')
    expect(cohort!.size).toBe(3)
    expect(cohort!.cells.map((cell) => cell.reached)).toEqual([1, 2, 2])
    expect(cohort!.cells.map((cell) => cell.complete)).toEqual([true, true, false])
    expect(cohort!.cells[1]!.share).toBeCloseTo(2 / 3, 12)
  })
})

// ─────────────────────────── Детектор отклонений ────────────────────────────

describe('детектор «Система заметила»', () => {
  const flat = (value: number, length: number) => new Array<number>(length).fill(value)

  it('меньше 35 полных дней — данных мало, отклонений не ищем', () => {
    const result = detectAnomaly([...flat(0, 27), ...flat(50, 7)])
    expect(result.status).toBe('insufficient_data')
    expect(result.isAnomaly).toBe(false)
  })

  it('ровный фон (sd = 0): знаменатель не меньше 1 — z = разница средних', () => {
    // Фон 2 в день, sd = 0 → scale = max(0; 0,02; 1) = 1.
    const edge = detectAnomaly([...flat(2, 28), ...flat(4, 7)])
    expect(edge.scale).toBe(1)
    expect(edge.z).toBe(2) // ровно 2 — не больше 2: не отклонение
    expect(edge.isAnomaly).toBe(false)
    const spike = detectAnomaly([...flat(2, 28), ...flat(5, 7)])
    expect(spike.z).toBe(3)
    expect(spike.relativeChange).toBe(1.5)
    expect(spike.isAnomaly).toBe(true)
    expect(spike.direction).toBe('up')
  })

  it('знаменатель — 1% среднего, когда фон большой и ровный', () => {
    const result = detectAnomaly([...flat(1000, 28), ...flat(1030, 7)])
    expect(result.scale).toBe(10)
    expect(result.z).toBe(3)
    // +3% — меньше 15%: значимо, но мало — не отклонение.
    expect(result.isAnomaly).toBe(false)
  })

  it('падение: |z| > 2 и изменение ≥ 15%', () => {
    const base = Array.from({ length: 28 }, (_, index) => (index % 2 === 0 ? 9 : 11))
    const result = detectAnomaly([...base, ...flat(4, 7)])
    expect(result.sdBase).toBeCloseTo(sampleSd(base), 12)
    expect(result.direction).toBe('down')
    expect(result.isAnomaly).toBe(true)
    expect(isAnomaly([...base, ...flat(4, 7)])).toBe(true)
  })

  it('фон нулевой, а сейчас не ноль — изменение бесконечное', () => {
    const result = detectAnomaly([...flat(0, 28), ...flat(3, 7)])
    expect(result.relativeChange).toBe(Number.POSITIVE_INFINITY)
    expect(result.isAnomaly).toBe(true)
  })

  it('берутся последние 35 точек: более ранняя история на окна не влияет', () => {
    const early = detectAnomaly([...flat(100, 20), ...flat(2, 28), ...flat(5, 7)])
    expect(early.meanBase).toBe(2)
    expect(early.isAnomaly).toBe(true)
  })

  it('текущий неполный день в ряд не входит', () => {
    const now = new Date('2026-09-25T10:00:00Z') // 13:00 по Москве
    const start = new Date('2026-09-20T00:00:00Z')
    const counts = dailyCounts(
      [new Date('2026-09-24T12:00:00Z'), new Date('2026-09-25T08:00:00Z'), new Date('2026-09-24T22:00:00Z')],
      start,
      now,
    )
    // 20.09–24.09 по Москве — 5 полных суток; 24.09 22:00 UTC — это уже 25.09 по Москве.
    expect(counts).toHaveLength(5)
    expect(counts.at(-1)).toBe(1)
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(1)
  })

  it('недели: неполная первая и текущая не входят', () => {
    const now = new Date('2026-09-25T10:00:00Z') // пятница
    const start = new Date('2026-09-02T10:00:00Z') // среда
    const counts = weeklyCounts([new Date('2026-09-08T10:00:00Z'), new Date('2026-09-23T10:00:00Z')], start, now)
    // Полные недели: 07.09–13.09 и 14.09–20.09.
    expect(counts).toEqual([1, 0])
    expect(ANOMALY_WEEKLY.minPoints).toBe(16)
  })

  it('разложение T = A × I — сумма вкладов ровно равна изменению', () => {
    const cases = [
      { totalBase: 2.9, totalRecent: 1.1, countBase: 5, countRecent: 4 },
      { totalBase: 0, totalRecent: 3, countBase: 0, countRecent: 2 },
      { totalBase: 4, totalRecent: 0, countBase: 3, countRecent: 0 },
      { totalBase: 1.5, totalRecent: 2, countBase: 0, countRecent: 0 },
    ]
    for (const input of cases) {
      const result = decomposeChange(input)
      expect(result.countEffect + result.intensityEffect).toBeCloseTo(input.totalRecent - input.totalBase, 12)
    }
    const example = decomposeChange(cases[0]!)
    // A: 5 → 4, I: 0,58 → 0,275. Вклад A = −1·(0,58+0,275)/2 = −0,4275.
    expect(example.countEffect).toBeCloseTo(-0.4275, 12)
    expect(example.intensityEffect).toBeCloseTo(-1.8 + 0.4275, 12)
  })

  it('вклады вузов: сумма = общему изменению, объясняющие — того же знака', () => {
    const rows = contributions(
      new Map([['a', 2], ['b', 1], ['c', 0.5]]),
      new Map([['a', 0.5], ['b', 0.2], ['c', 0.8], ['d', 0.1]]),
    )
    const total = rows.reduce((sum, row) => sum + row.delta, 0)
    expect(total).toBeCloseTo(-1.9, 12)
    expect(rows.reduce((sum, row) => sum + (row.share ?? 0), 0)).toBeCloseTo(1, 12)
    expect(rows[0]!.key).toBe('a')
    const top = explainingSlices(rows, 0.6)
    expect(top.map((row) => row.key)).toEqual(['a'])
    expect(explainingSlices(rows, 0.9).map((row) => row.key)).toEqual(['a', 'b'])
  })

  it('инсайт об отклонении: факты разложения складываются в изменение', () => {
    const now = new Date('2026-09-25T10:00:00Z')
    const { todayStart } = dailyWindows(now)
    const points: SeriesPoint[] = []
    // Фон: 28 дней по 5 переходов (вуз A — 3, вуз B — 2); последние 7 дней — только B по 1.
    for (let day = 35; day >= 8; day -= 1) {
      const moment = new Date(todayStart.getTime() - day * DAY + 12 * 60 * 60 * 1000)
      points.push(
        { at: moment, universityId: 'A' },
        { at: moment, universityId: 'A' },
        { at: moment, universityId: 'A' },
        { at: moment, universityId: 'B' },
        { at: moment, universityId: 'B' },
      )
    }
    for (let day = 7; day >= 1; day -= 1) {
      points.push({ at: new Date(todayStart.getTime() - day * DAY + 12 * 60 * 60 * 1000), universityId: 'B' })
    }
    const ctx: InsightContext = {
      now,
      historyStart: new Date(todayStart.getTime() - 60 * DAY),
      series: { new_cooperations: [], stage_transitions: points, meetings: [], dismissed_recommendations: [] },
      spans: [
        { universityId: 'A', start: new Date(todayStart.getTime() - 60 * DAY), closedAt: new Date(todayStart.getTime() - 8 * DAY) },
        { universityId: 'B', start: new Date(todayStart.getTime() - 60 * DAY), closedAt: null },
      ],
      universityLabels: new Map([['A', 'Вуз А'], ['B', 'Вуз Б']]),
      durations: [],
      stalled: { count: 0, byData: 0 },
      funnel: null,
    }
    const { insights, checks } = buildInsights(ctx)
    const drop = insights.find((item) => item.code === 'anomaly.stage_transitions.down')!
    expect(drop).toBeDefined()
    expect(drop.facts.meanBase).toBe(5)
    expect(drop.facts.meanRecent).toBe(1)
    expect(drop.facts.z).toBe(-4)
    expect(Number(drop.facts.countEffect) + Number(drop.facts.intensityEffect)).toBeCloseTo(-4, 12)
    expect(drop.facts.activeUniversitiesBase).toBe(2)
    expect(drop.facts.activeUniversitiesRecent).toBe(1)
    const slices = drop.facts.slices as Array<{ key: string; delta: number }>
    expect(slices.map((slice) => slice.key)).toEqual(['A'])
    expect(drop.detail).toContain('Вуз А')
    expect(checks).toBeGreaterThan(0)
    expect(ANOMALY_DAILY.recent + ANOMALY_DAILY.base).toBe(35)
  })
})

// ─────────────────────────── Порог застоя ────────────────────────────────────

describe('порог застоя: одна точка подмены', () => {
  afterEach(() => resetStageDurations())

  // 40 наблюдений: 30 переходов на днях 5, 10, …, 30 и 10 цензурированных — p90 дальше 20 дней.
  const withData = summarizeDurations(
    Array.from({ length: 40 }, (_, index) => obs(((index % 6) + 1) * 5, index < 30)),
  )

  it('пока сводок нет — ручной stalledDays', () => {
    expect(getStalledThreshold(6)).toMatchObject({
      days: RECOMMENDATION_RULES.stalledDays,
      source: 'manual',
      reason: 'not_computed',
    })
  })

  it('данных хватает — p90 по Каплану–Мейеру с интервалом', () => {
    expect(withData.status).toBe('ok')
    setStageDurations(new Map([[6, withData]]))
    const threshold = getStalledThreshold(6)
    expect(threshold.source).toBe('km')
    expect(threshold.days).toBe(withData.p90.day)
    expect(threshold.ci).toEqual(withData.p90.ci)
    expect(threshold.n).toBe(40)
    // Другой этап без сводки — ручной.
    expect(getStalledThreshold(5).source).toBe('manual')
  })

  it('правило «связка без движения» берёт порог этапа из getStalledThreshold', () => {
    const input = {
      cooperationId: 'c1',
      universityName: 'Вуз',
      programName: 'Программа',
      stageNumber: 6,
      stageTitle: 'Подписание документов',
      stageStatus: 'IN_PROGRESS' as const,
      lastActivityAt: new Date('2026-09-01T09:00:00Z'),
    }
    const now = new Date('2026-09-21T09:00:00Z') // 20 дней без движения
    // Ручной порог 14: застой.
    expect(ruleStalledCooperation(input, now)?.relatedData).toMatchObject({ idleDays: 20, thresholdSource: 'manual' })
    // По данным p90 этапа 6 больше 20 дней — не застой.
    setStageDurations(new Map([[6, withData]]))
    expect(withData.p90.day!).toBeGreaterThan(20)
    expect(ruleStalledCooperation(input, now)).toBeNull()
    const later = new Date(now.getTime() + 30 * DAY)
    const draft = ruleStalledCooperation(input, later)
    expect(draft?.relatedData).toMatchObject({ thresholdSource: 'km', thresholdDays: withData.p90.day })
    expect(draft?.justification).toContain('проходят 90% связок')
  })

  it('«почему нет рекомендации» видит тот же порог по данным, что и правило (решения 119 + 120)', () => {
    const coopInput: CooperationRuleInput = {
      id: 'coop-why-not',
      productId: 'product-1',
      updatedAt: new Date('2026-09-01T09:00:00Z'),
      university: { name: 'Вуз' },
      program: { name: 'Программа' },
      stages: Array.from({ length: 14 }, (_, index) => {
        const stageNumber = index + 1
        return {
          stageNumber,
          title: `Этап ${stageNumber}`,
          status: stageNumber < 6 ? 'COMPLETED' : stageNumber === 6 ? 'IN_PROGRESS' : 'NOT_STARTED',
          deadline: null,
          responsible: null,
          history: [],
          tasks: [],
        }
      }),
    }
    const now = new Date('2026-09-21T09:00:00Z') // 20 дней без движения

    // Ручной порог 14 дней: связка без движения 20 дней — застой уже виден и правилу, и why-not.
    expect(stalledDaysThreshold(6)).toBe(RECOMMENDATION_RULES.stalledDays)
    const manualCheck = evaluateCooperation(coopInput, now)
      .find((item) => item.ruleKey === 'cooperation.stalled')!
      .checks.find((item) => item.code === 'cooperation_stalled')!
    expect(manualCheck.facts.threshold).toBe(RECOMMENDATION_RULES.stalledDays)
    expect(ruleStalledCooperation(
      { cooperationId: coopInput.id, universityName: 'Вуз', programName: 'Программа', stageNumber: 6, stageTitle: 'Этап 6', stageStatus: 'IN_PROGRESS', lastActivityAt: coopInput.updatedAt },
      now,
    )?.relatedData.thresholdDays).toBe(manualCheck.facts.threshold)

    // Порог по данным p90 этапа 6 — 20 дней ещё не застой ни для правила, ни для why-not.
    setStageDurations(new Map([[6, withData]]))
    expect(stalledDaysThreshold(6)).toBe(withData.p90.day)
    const dataCheck = evaluateCooperation(coopInput, now)
      .find((item) => item.ruleKey === 'cooperation.stalled')!
      .checks.find((item) => item.code === 'cooperation_stalled')!
    expect(dataCheck.pass).toBe(false)
    expect(dataCheck.facts.threshold).toBe(withData.p90.day)
    expect(
      ruleStalledCooperation(
        { cooperationId: coopInput.id, universityName: 'Вуз', programName: 'Программа', stageNumber: 6, stageTitle: 'Этап 6', stageStatus: 'IN_PROGRESS', lastActivityAt: coopInput.updatedAt },
        now,
      ),
    ).toBeNull()

    // Дальше порога по данным — застой виден и правилу, и why-not, с одним и тем же числом.
    const later = new Date(now.getTime() + 30 * DAY)
    const laterCheck = evaluateCooperation(coopInput, later)
      .find((item) => item.ruleKey === 'cooperation.stalled')!
      .checks.find((item) => item.code === 'cooperation_stalled')!
    expect(laterCheck.pass).toBe(true)
    expect(laterCheck.facts.threshold).toBe(withData.p90.day)
    const laterDraft = ruleStalledCooperation(
      { cooperationId: coopInput.id, universityName: 'Вуз', programName: 'Программа', stageNumber: 6, stageTitle: 'Этап 6', stageStatus: 'IN_PROGRESS', lastActivityAt: coopInput.updatedAt },
      later,
    )
    expect(laterDraft?.relatedData.thresholdDays).toBe(laterCheck.facts.threshold)
  })

  it('мало данных — ручной с причиной; флаг выключен — ручной всегда', () => {
    const few = summarizeDurations([obs(3, true), obs(5, false)])
    expect(thresholdFrom(few)).toMatchObject({ source: 'manual', reason: 'insufficient_data', n: 2, events: 1 })
    expect(thresholdFrom(withData, { fromData: false, manualDays: 14 })).toMatchObject({
      source: 'manual',
      reason: 'disabled',
      days: 14,
    })
  })
})

// ─────────────────────────────── Пульс ──────────────────────────────────────

describe('пульс', () => {
  const now = new Date('2026-09-25T09:00:00Z')
  const empty = {
    stalled: [],
    meetingsWithoutResult: [],
    meetingsToday: [],
    actionsToday: [],
    completions: [],
    insights: [],
    insightChecks: 4,
  }

  it('пусто — «всё спокойно» со счётчиком проверенных правил', () => {
    const pulse = buildPulse({ stages: [], recommendations: [], extras: empty }, now)
    expect(pulse.isCalm).toBe(true)
    expect(pulse.checkedRules).toBe(5 + 6 + 4)
    const dto = toPulseDto(pulse)
    expect(dto.calmText).toContain('проверено 15 правил')
    expect(dto.sections.map((section) => section.key)).toEqual(['attention', 'today', 'decide', 'wins'])
  })

  it('разделы, потолок пунктов и без повторов застоя в «Решить»', () => {
    const pulse = buildPulse(
      {
        stages: [],
        recommendations: [
          {
            id: 'r1',
            ruleKey: 'cooperation.stalled',
            stageNumber: 6,
            title: 'Связка без движения 30 дн.',
            label: 'Вуз — Программа',
            priority: 'MEDIUM',
            cooperationId: 'c1',
            status: 'NEW',
            createdAt: new Date(now.getTime() - 10 * DAY),
          },
          {
            id: 'r2',
            ruleKey: 'program.missing-metrics',
            stageNumber: null,
            title: 'Нет данных по программе',
            label: 'Программа',
            priority: 'LOW',
            cooperationId: null,
            status: 'NEW',
            createdAt: new Date(now.getTime() - 8 * DAY),
          },
          {
            id: 'r3',
            ruleKey: 'cooperation.no-product',
            stageNumber: null,
            title: 'Выберите продукт',
            label: 'Вуз 2',
            priority: 'HIGH',
            cooperationId: 'c2',
            status: 'IN_PROGRESS',
            createdAt: new Date(now.getTime() - 30 * DAY),
          },
        ],
        extras: {
          ...empty,
          stalled: [
            {
              cooperationId: 'c1',
              stageNumber: 6,
              stageTitle: 'Подписание документов',
              universityName: 'Вуз',
              programName: 'Программа',
              idleDays: 30,
              thresholdDays: 21,
              thresholdSource: 'km',
            },
          ],
          completions: Array.from({ length: 12 }, (_, index) => ({
            stageId: `s${index}`,
            stageNumber: 2,
            stageTitle: 'Связь',
            cooperationId: `k${index}`,
            universityName: 'Вуз',
            programName: 'П',
            at: now,
          })),
        },
      },
      now,
    )
    expect(pulse.counts['cooperation.stalled']).toBe(1)
    // r1 — о той же застрявшей связке: во «Внимании» уже есть.
    expect(pulse.counts['recommendation.stale']).toBe(1)
    expect(pulse.counts['recommendation.open']).toBe(1)
    expect(pulse.isCalm).toBe(false)
    const dto = toPulseDto(pulse, 10)
    const wins = dto.sections.find((section) => section.key === 'wins')!
    expect(wins.total).toBe(12)
    expect(wins.items).toHaveLength(10)
    const attention = dto.sections.find((section) => section.key === 'attention')!
    expect(attention.items[0]!.text).toContain('при пороге 21')
  })
})
