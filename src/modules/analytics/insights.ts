import type { InsightDto, InsightSeverity, InsightSliceDto } from '@/shared/contracts/stage-analytics'
import { INSIGHTS, RECOMMENDATION_RULES, STALLED_THRESHOLD } from '@/shared/config/analytics.config'
import { ROUTES, universityHref } from '@/ui/lib/links'
import {
  ANOMALY_DAILY,
  ANOMALY_WEEKLY,
  contributions,
  dailyCounts,
  decomposeChange,
  detectAnomaly,
  explainingSlices,
  moscowDayIndex,
  weeklyCounts,
  type AnomalyResult,
} from './anomaly'
import type { Funnel } from './funnel'
import type { DurationSummary } from './survival'

/**
 * «Система заметила» — детерминированные тексты по шаблонам (решение 120).
 * Чистый модуль: ряды, сводки этапов и воронка приходят готовыми, наружу —
 * список инсайтов `{code, severity, title, detail, facts, link}` и число проверок.
 * Никакого ИИ: каждое число в тексте есть в `facts`.
 */

export type SeriesMetric = 'new_cooperations' | 'stage_transitions' | 'meetings' | 'dismissed_recommendations'

export const SERIES_METRICS: readonly SeriesMetric[] = [
  'new_cooperations',
  'stage_transitions',
  'meetings',
  'dismissed_recommendations',
]

/** Подписи ряда: как называть в заголовке и что считать «на вуз». */
export const METRIC_LABELS: Record<SeriesMetric, { name: string; of: string }> = {
  new_cooperations: { name: 'Новые связки', of: 'новых связок' },
  stage_transitions: { name: 'Переходы этапов', of: 'закрытых этапов' },
  meetings: { name: 'Встречи', of: 'встреч' },
  dismissed_recommendations: { name: 'Отклонённые рекомендации', of: 'отклонённых рекомендаций' },
}

export interface SeriesPoint {
  at: Date
  universityId: string | null
}

export interface InsightContext {
  now: Date
  /** Первое событие в данных; null — данных нет. */
  historyStart: Date | null
  series: Record<SeriesMetric, readonly SeriesPoint[]>
  /** Связки для «активных вузов» в окне. */
  spans: ReadonlyArray<{ universityId: string; start: Date; closedAt: Date | null }>
  universityLabels: ReadonlyMap<string, string>
  durations: ReadonlyArray<{ stageNumber: number; title: string; summary: DurationSummary }>
  /** Открытые связки, по которым сейчас срабатывает правило застоя. */
  stalled: { count: number; byData: number }
  /** Воронка по вехам. null — не считалась. */
  funnel: Funnel | null
}

export interface InsightsResult {
  insights: InsightDto[]
  /** Сколько проверок выполнено: рядов с достаточной историей и правил по этапам. */
  checks: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const SEVERITY_RANK: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 }
const NO_UNIVERSITY = '—'

/** Число по-русски: одна цифра после запятой, без «-0». */
export function formatNumber(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits))
  return (Object.is(rounded, -0) ? 0 : rounded).toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })
}

const signed = (value: number): string => (value > 0 ? `+${formatNumber(value)}` : formatNumber(value))
const percentOf = (value: number): number => Math.round(Math.abs(value) * 100)

/** Границы окон дневного детектора: [baseStart, recentStart) и [recentStart, todayStart). */
export function dailyWindows(now: Date): { todayStart: Date; recentStart: Date; baseStart: Date } {
  const today = moscowDayIndex(now)
  const toDate = (day: number) => new Date(day * DAY_MS - 3 * 60 * 60 * 1000)
  return {
    todayStart: toDate(today),
    recentStart: toDate(today - ANOMALY_DAILY.recent),
    baseStart: toDate(today - ANOMALY_DAILY.recent - ANOMALY_DAILY.base),
  }
}

function seriesStart(historyStart: Date, earliest: Date): Date {
  return historyStart > earliest ? historyStart : earliest
}

/** Первые полные московские сутки истории: день первого события неполный. */
function firstFullDay(historyStart: Date): Date {
  const day = moscowDayIndex(historyStart)
  const midnight = new Date(day * DAY_MS - 3 * 60 * 60 * 1000)
  return midnight.getTime() === historyStart.getTime() ? midnight : new Date(midnight.getTime() + DAY_MS)
}

function activeUniversities(
  spans: InsightContext['spans'],
  from: Date,
  to: Date,
): number {
  const active = new Set<string>()
  for (const span of spans) {
    if (span.start < to && (span.closedAt === null || span.closedAt > from)) active.add(span.universityId)
  }
  return active.size
}

function countByUniversity(points: readonly SeriesPoint[], from: Date, to: Date, days: number): Map<string, number> {
  const result = new Map<string, number>()
  for (const point of points) {
    if (point.at < from || point.at >= to) continue
    const key = point.universityId ?? NO_UNIVERSITY
    result.set(key, (result.get(key) ?? 0) + 1 / days)
  }
  return result
}

function directionWord(result: AnomalyResult): string {
  return result.direction === 'up' ? 'больше' : 'меньше'
}

function changePhrase(result: AnomalyResult): string {
  if (result.relativeChange === Number.POSITIVE_INFINITY) return 'появились при нулевом фоне'
  return `на ${percentOf(result.relativeChange ?? 0)}% ${directionWord(result)} обычного`
}

function severityOf(result: AnomalyResult): InsightSeverity {
  return Math.abs(result.z ?? 0) > 3 ? 'critical' : 'warning'
}

/** Отклонение общего дневного ряда с разложением и вкладами вузов. */
function dailyInsight(
  metric: SeriesMetric,
  result: AnomalyResult,
  ctx: InsightContext,
): InsightDto {
  const label = METRIC_LABELS[metric]
  const { todayStart, recentStart, baseStart } = dailyWindows(ctx.now)
  const points = ctx.series[metric]
  const decomposition = decomposeChange({
    totalBase: result.meanBase ?? 0,
    totalRecent: result.meanRecent ?? 0,
    countBase: activeUniversities(ctx.spans, baseStart, recentStart),
    countRecent: activeUniversities(ctx.spans, recentStart, todayStart),
  })
  const rows = contributions(
    countByUniversity(points, baseStart, recentStart, ANOMALY_DAILY.base),
    countByUniversity(points, recentStart, todayStart, ANOMALY_DAILY.recent),
  )
  const explaining = explainingSlices(rows, 0.5)
  const slices: InsightSliceDto[] = explaining.map((row) => ({
    key: row.key,
    label: row.key === NO_UNIVERSITY ? 'без вуза' : (ctx.universityLabels.get(row.key) ?? row.key),
    delta: Number(row.delta.toFixed(3)),
    share: row.share === null ? null : Number(row.share.toFixed(3)),
  }))
  const covered = explaining.reduce((sum, row) => sum + (row.share ?? 0), 0)
  const change = result.direction === 'up' ? 'роста' : 'падения'
  const listed = slices.map((slice) => `${slice.label} (${signed(slice.delta)} в день)`).join(', ')
  const rest = decomposition.change - explaining.reduce((sum, row) => sum + row.delta, 0)
  // Больше 100% — остальные вузы сдвинулись в обратную сторону: так и пишем.
  const slicesText =
    slices.length === 0
      ? ''
      : covered >= 1
        ? ` Всё изменение даёт ${listed}; остальные вместе — ${signed(rest)} в день.`
        : ` ${percentOf(covered)}% ${change} объясняют: ${listed}.`

  return {
    code: `anomaly.${metric}.${result.direction === 'up' ? 'up' : 'down'}`,
    severity: severityOf(result),
    title: `${label.name}: за ${ANOMALY_DAILY.recent} дней ${changePhrase(result)}`,
    detail:
      `В среднем ${formatNumber(result.meanRecent ?? 0)} в день против ${formatNumber(result.meanBase ?? 0)} ` +
      `за ${ANOMALY_DAILY.base} дней до этого (z = ${formatNumber(result.z ?? 0)}). ` +
      `Активных вузов ${decomposition.countBase} → ${decomposition.countRecent} ` +
      `(вклад ${signed(decomposition.countEffect)} в день), ${label.of} на вуз ` +
      `${formatNumber(decomposition.intensityBase, 2)} → ${formatNumber(decomposition.intensityRecent, 2)} ` +
      `(вклад ${signed(decomposition.intensityEffect)} в день).` +
      slicesText,
    facts: {
      metric,
      window: 'day',
      meanRecent: result.meanRecent,
      meanBase: result.meanBase,
      sdBase: result.sdBase,
      z: result.z,
      relativeChange: Number.isFinite(result.relativeChange ?? 0) ? result.relativeChange : null,
      change: decomposition.change,
      activeUniversitiesBase: decomposition.countBase,
      activeUniversitiesRecent: decomposition.countRecent,
      perUniversityBase: decomposition.intensityBase,
      perUniversityRecent: decomposition.intensityRecent,
      countEffect: decomposition.countEffect,
      intensityEffect: decomposition.intensityEffect,
      slices,
    },
    link: `${ROUTES.analytics}?tab=insights`,
  }
}

function weeklyInsight(metric: SeriesMetric, result: AnomalyResult): InsightDto {
  const label = METRIC_LABELS[metric]
  return {
    code: `anomaly.${metric}.weekly.${result.direction === 'up' ? 'up' : 'down'}`,
    severity: severityOf(result),
    title: `${label.name}: за ${ANOMALY_WEEKLY.recent} недели ${changePhrase(result)}`,
    detail:
      `В среднем ${formatNumber(result.meanRecent ?? 0)} в неделю против ${formatNumber(result.meanBase ?? 0)} ` +
      `за ${ANOMALY_WEEKLY.base} недель до этого (z = ${formatNumber(result.z ?? 0)}).`,
    facts: {
      metric,
      window: 'week',
      meanRecent: result.meanRecent,
      meanBase: result.meanBase,
      sdBase: result.sdBase,
      z: result.z,
      relativeChange: Number.isFinite(result.relativeChange ?? 0) ? result.relativeChange : null,
    },
    link: `${ROUTES.analytics}?tab=insights`,
  }
}

function universityInsight(
  metric: SeriesMetric,
  universityId: string,
  label: string,
  result: AnomalyResult,
): InsightDto {
  return {
    code: `anomaly.university.${metric}.${result.direction === 'up' ? 'up' : 'down'}`,
    severity: severityOf(result),
    title: `${label}: ${METRIC_LABELS[metric].of} за ${ANOMALY_DAILY.recent} дней ${changePhrase(result)}`,
    detail:
      `В среднем ${formatNumber(result.meanRecent ?? 0)} в день против ${formatNumber(result.meanBase ?? 0)} ` +
      `за ${ANOMALY_DAILY.base} дней до этого (z = ${formatNumber(result.z ?? 0)}).`,
    facts: {
      metric,
      universityId,
      meanRecent: result.meanRecent,
      meanBase: result.meanBase,
      z: result.z,
      relativeChange: Number.isFinite(result.relativeChange ?? 0) ? result.relativeChange : null,
    },
    link: universityHref(universityId),
  }
}

function seriesInsights(ctx: InsightContext): InsightsResult {
  const insights: InsightDto[] = []
  let checks = 0
  if (!ctx.historyStart) return { insights, checks }
  const { baseStart } = dailyWindows(ctx.now)
  const dailyStart = seriesStart(firstFullDay(ctx.historyStart), baseStart)
  const weeklyEarliest = new Date(
    baseStart.getTime() - (ANOMALY_WEEKLY.recent + ANOMALY_WEEKLY.base) * 7 * DAY_MS,
  )
  const weeklyStart = seriesStart(ctx.historyStart, weeklyEarliest)
  const universityCandidates: Array<{ result: AnomalyResult; insight: InsightDto }> = []

  for (const metric of SERIES_METRICS) {
    const dates = ctx.series[metric].map((point) => point.at)
    const daily = detectAnomaly(dailyCounts(dates, dailyStart, ctx.now), ANOMALY_DAILY)
    if (daily.status === 'ok') checks += 1
    if (daily.isAnomaly) insights.push(dailyInsight(metric, daily, ctx))

    const weekly = detectAnomaly(weeklyCounts(dates, weeklyStart, ctx.now), ANOMALY_WEEKLY)
    if (weekly.status === 'ok') checks += 1
    // Недельное отклонение — только если дневной ряд его не показал: одно и то же дважды не говорим.
    if (weekly.isAnomaly && !daily.isAnomaly) insights.push(weeklyInsight(metric, weekly))

    if (daily.status !== 'ok') continue
    const byUniversity = new Map<string, Date[]>()
    for (const point of ctx.series[metric]) {
      if (!point.universityId || point.at < baseStart) continue
      const list = byUniversity.get(point.universityId) ?? []
      list.push(point.at)
      byUniversity.set(point.universityId, list)
    }
    for (const [universityId, list] of byUniversity) {
      const result = detectAnomaly(dailyCounts(list, dailyStart, ctx.now), ANOMALY_DAILY)
      if (result.status === 'ok') checks += 1
      if (!result.isAnomaly) continue
      const label = ctx.universityLabels.get(universityId) ?? universityId
      universityCandidates.push({ result, insight: universityInsight(metric, universityId, label, result) })
    }
  }

  universityCandidates
    .sort(
      (a, b) =>
        Math.abs(b.result.z ?? 0) - Math.abs(a.result.z ?? 0) || a.insight.code.localeCompare(b.insight.code),
    )
    .slice(0, INSIGHTS.universityAnomalyLimit)
    .forEach((item) => insights.push(item.insight))
  return { insights, checks }
}

function stageInsights(ctx: InsightContext): InsightsResult {
  const insights: InsightDto[] = []
  const withData = ctx.durations.filter((item) => item.summary.status === 'ok')
  if (withData.length === 0) {
    const best = [...ctx.durations].sort(
      (a, b) => b.summary.events - a.summary.events || b.summary.n - a.summary.n || a.stageNumber - b.stageNumber,
    )[0]
    insights.push({
      code: 'stages.insufficient_data',
      severity: 'info',
      title: 'Порог застоя пока ручной: истории этапов мало',
      detail:
        `Длительность этапа считается по истории переходов, когда по этапу не меньше ` +
        `${STALLED_THRESHOLD.minObservations} связок и ${STALLED_THRESHOLD.minEvents} переходов. ` +
        (best
          ? `Больше всего данных у этапа ${best.stageNumber}: ${best.summary.n} связок, ${best.summary.events} переходов. `
          : '') +
        `До тех пор правило «связка без движения» берёт ручные ${RECOMMENDATION_RULES.stalledDays} дн.`,
      facts: {
        minObservations: STALLED_THRESHOLD.minObservations,
        minEvents: STALLED_THRESHOLD.minEvents,
        manualDays: RECOMMENDATION_RULES.stalledDays,
        bestStage: best?.stageNumber ?? null,
        bestObservations: best?.summary.n ?? null,
        bestEvents: best?.summary.events ?? null,
      },
      link: `${ROUTES.analytics}?tab=stages`,
    })
  } else {
    const slowest = [...withData]
      .filter((item) => item.summary.median.day !== null)
      .sort((a, b) => (b.summary.median.day ?? 0) - (a.summary.median.day ?? 0) || a.stageNumber - b.stageNumber)[0]
    if (slowest) {
      insights.push({
        code: 'stage.slowest',
        severity: 'info',
        title: `Дольше всего идёт этап ${slowest.stageNumber} «${slowest.title}»`,
        detail:
          `Половина связок проходит его за ${slowest.summary.median.day} дн.` +
          (slowest.summary.p90.day !== null
            ? `, 90% — за ${slowest.summary.p90.day} дн.; дольше — «застряла».`
            : '.') +
          ` По истории ${slowest.summary.n} связок, ${slowest.summary.events} переходов.`,
        facts: {
          stageNumber: slowest.stageNumber,
          median: slowest.summary.median.day,
          p90: slowest.summary.p90.day,
          n: slowest.summary.n,
          events: slowest.summary.events,
        },
        link: `${ROUTES.analytics}?tab=stages&stage=${slowest.stageNumber}`,
      })
    }
  }

  if (ctx.stalled.count > 0) {
    insights.push({
      code: 'cooperations.stalled',
      severity: 'warning',
      title: `Связок без движения дольше порога: ${ctx.stalled.count}`,
      detail:
        ctx.stalled.byData > 0
          ? `У ${ctx.stalled.byData} из них порог посчитан по истории этапа (p90), у остальных — ручной.`
          : `Порог ручной: ${RECOMMENDATION_RULES.stalledDays} дн. без движения.`,
      facts: { count: ctx.stalled.count, byData: ctx.stalled.byData },
      link: ROUTES.recommendations,
    })
  }

  const bottleneck = ctx.funnel?.steps
    .filter((step) => step.droppedCount > 0)
    .sort((a, b) => b.droppedCount - a.droppedCount || a.fromStage - b.fromStage)[0]
  if (bottleneck) {
    insights.push({
      code: 'funnel.bottleneck',
      severity: 'info',
      title: `Чаще всего связки останавливаются на шаге «${bottleneck.title}»`,
      detail:
        `Отменены или на паузе, не пройдя дальше: ${bottleneck.droppedCount} из ${bottleneck.reached} ` +
        `дошедших до этого шага.`,
      facts: { step: bottleneck.key, dropped: bottleneck.droppedCount, reached: bottleneck.reached },
      link: `${ROUTES.analytics}?tab=funnel`,
    })
  }
  // Проверки по этапам: сводка длительности, правило застоя, воронка.
  return { insights, checks: 3 }
}

/** Все инсайты по порядку: важность, затем сила отклонения, затем код. */
export function buildInsights(ctx: InsightContext): InsightsResult {
  const series = seriesInsights(ctx)
  const stages = stageInsights(ctx)
  const zOf = (item: InsightDto) => Math.abs(typeof item.facts.z === 'number' ? item.facts.z : 0)
  const insights = [...series.insights, ...stages.insights].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || zOf(b) - zOf(a) || a.code.localeCompare(b.code),
  )
  return { insights, checks: series.checks + stages.checks }
}
