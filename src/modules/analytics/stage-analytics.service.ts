import { assertCan, universityScope } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { log } from '@/shared/log'
import { STALLED_THRESHOLD } from '@/shared/config/analytics.config'
import { CONTROL_STAGE_NUMBER, WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import { PROGRAM_LEVEL_LABELS } from '@/shared/contracts/labels'
import type {
  CohortsDto,
  FunnelDto,
  InsightDto,
  StageDurationDto,
  StageDurationsDto,
  StalledPreviewDto,
  StalledPreviewItemDto,
  StalledPreviewStageDto,
  StalledThresholdDto,
} from '@/shared/contracts/stage-analytics'
import { cooperationHref } from '@/ui/lib/links'
import { findCurrentStage } from '@/modules/workflow/workflow.rules'
import { draftsForCooperation, lastCooperationActivity } from '@/modules/recommendations/recommendations.rules'
import { daysBetween } from '@/shared/utils/date'
import * as repo from './stage-analytics.repo'
import { summarizeDurations, type DurationSummary } from './survival'
import { buildStageTimeline, stageObservations, type StageTimeline } from './stage-timeline'
import {
  buildCohorts,
  buildFunnel,
  COHORT_MILESTONE,
  MILESTONE_STEPS,
  STAGE_STEPS,
  type FunnelSubject,
} from './funnel'
import {
  cachedStageDurations,
  getStalledThreshold,
  setStageDurations,
  stageDurationsStale,
  thresholdFrom,
  type StalledThreshold,
} from './stalled-threshold'
import { ANOMALY_WEEKLY } from './anomaly'
import { buildInsights, type InsightsResult, type SeriesMetric, type SeriesPoint } from './insights'
import type { FunnelQuery, StalledPreviewQuery } from './stage-analytics.schema'

/**
 * Аналитика этапов на статистике (решение 120): длительность этапов по
 * Каплану–Мейеру, порог застоя, воронка, когорты, «Система заметила».
 * Формулы — в чистых модулях `survival.ts`, `stage-timeline.ts`, `funnel.ts`,
 * `anomaly.ts`, `insights.ts`; здесь — права, загрузка и сборка ответа.
 */

const SOURCE = 'История этапов и записи системы'
const STAGE_TITLES = new Map(WORKFLOW_STAGES.map((stage) => [stage.number, stage.title]))
const MEASURED_STAGES = WORKFLOW_STAGES.map((stage) => stage.number).filter((number) => number < CONTROL_STAGE_NUMBER)
const DAY_MS = 24 * 60 * 60 * 1000

const surveyOptions = () => ({
  minObservations: STALLED_THRESHOLD.minObservations,
  minEvents: STALLED_THRESHOLD.minEvents,
  stalledQuantile: STALLED_THRESHOLD.quantile,
})

function toTimeline(row: repo.TimelineRow, now: Date): StageTimeline {
  return buildStageTimeline(row, now)
}

/** Сводки длительности по этапам 1–13 из хронологий. */
export function summarizeStages(timelines: readonly StageTimeline[]): Map<number, DurationSummary> {
  const result = new Map<number, DurationSummary>()
  for (const stage of MEASURED_STAGES) {
    result.set(stage, summarizeDurations(stageObservations(timelines, stage), surveyOptions()))
  }
  return result
}

// ───────────────────── Память порогов для правила застоя ─────────────────────

let inflight: Promise<ReadonlyMap<number, DurationSummary>> | null = null

/**
 * Посчитать сводки по всей базе и положить в память порогов (`stalled-threshold.ts`),
 * если там пусто или устарело. Зовут пересборка рекомендаций, пульс и предпросмотр.
 * Не бросает: сбой расчёта оставляет прежние сводки (или ручной порог).
 */
export async function ensureStageDurations(now: Date = new Date()): Promise<ReadonlyMap<number, DurationSummary>> {
  if (!stageDurationsStale(now.getTime())) return cachedStageDurations()!
  if (!inflight) {
    inflight = (async () => {
      try {
        const rows = await repo.findTimelineRows({})
        const summaries = summarizeStages(rows.map((row) => toTimeline(row, now)))
        setStageDurations(summaries, now.getTime())
        return summaries
      } catch (error) {
        log.error('[ANALYTICS] не удалось посчитать длительность этапов', { err: error })
        return cachedStageDurations() ?? new Map()
      } finally {
        inflight = null
      }
    })()
  }
  return inflight
}

function thresholdDto(threshold: StalledThreshold): StalledThresholdDto {
  return { ...threshold }
}

// ─────────────────────────── Длительность этапов ────────────────────────────

export async function stageDurations(user: CurrentUser, now: Date = new Date()): Promise<StageDurationsDto> {
  assertCan(user, 'ANALYTICS')
  const scope = universityScope(user)
  const rows = await repo.findTimelineRows(scope)
  const timelines = rows.map((row) => toTimeline(row, now))
  const summaries = summarizeStages(timelines)
  // Правило застоя работает по всей базе; ответ по области видимости — ту же
  // память обновляем, только если область — вся база.
  if (Object.keys(scope).length === 0) setStageDurations(summaries, now.getTime())

  const stages: StageDurationDto[] = MEASURED_STAGES.map((number) => {
    const summary = summaries.get(number)!
    return {
      stageNumber: number,
      title: STAGE_TITLES.get(number) ?? `Этап ${number}`,
      status: summary.status,
      n: summary.n,
      events: summary.events,
      censored: summary.censored,
      median: summary.median.day,
      p90: summary.p90.day,
      ci: { median: summary.median.ci, p90: summary.p90.ci },
      curve: summary.curve.map((point) => ({
        day: point.day,
        F: round4(point.F),
        lo: round4(point.lo),
        hi: round4(point.hi),
      })),
      threshold: thresholdDto(thresholdFrom(summary)),
    }
  })
  return {
    stages,
    minObservations: STALLED_THRESHOLD.minObservations,
    minEvents: STALLED_THRESHOLD.minEvents,
    quantile: STALLED_THRESHOLD.quantile,
    fromData: STALLED_THRESHOLD.fromData,
    generatedAt: now.toISOString(),
    isMock: rows.some((row) => row.isMock),
    source: SOURCE,
  }
}

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000

// ─────────────────────────── Предпросмотр порога ────────────────────────────

export interface StalledState {
  cooperationId: string
  title: string
  universityName: string
  programName: string
  stageNumber: number
  stageTitle: string
  idleDays: number
  /** Сработало правило застоя сейчас (с текущим порогом и подавлением просрочкой). */
  stalledNow: boolean
  /** Есть рекомендация о просрочке — о застое тогда не говорят. */
  hasOverdue: boolean
  isMock: boolean
}

const cooperationTitle = (row: {
  university: { name: string; shortName: string | null }
  program: { name: string }
}): string => `${row.university.shortName ?? row.university.name} — ${row.program.name}`

/** Состояние застоя открытых связок — ровно тем правилом, что у рекомендаций. */
export async function stalledStates(
  scope: { universityId?: string },
  now: Date,
  options: { responsibleId?: string } = {},
): Promise<StalledState[]> {
  await ensureStageDurations(now)
  const rows = await repo.findStalledCandidates(scope, options)
  const states: StalledState[] = []
  for (const row of rows) {
    const current = findCurrentStage(row.stages)
    if (!current) continue
    const drafts = draftsForCooperation(row, now)
    const stalled = drafts.find((draft) => draft.ruleKey === 'cooperation.stalled')
    const idle = stalled
      ? Number(stalled.relatedData.idleDays)
      : daysBetween(lastCooperationActivity(row), now)
    states.push({
      cooperationId: row.id,
      title: cooperationTitle(row),
      universityName: row.university.shortName ?? row.university.name,
      programName: row.program.name,
      stageNumber: current.stageNumber,
      stageTitle: current.title,
      idleDays: idle,
      stalledNow: stalled !== undefined,
      hasOverdue: drafts.some((draft) => draft.ruleKey === 'stage.overdue'),
      isMock: row.isMock,
    })
  }
  return states
}

export async function stalledPreview(
  user: CurrentUser,
  query: StalledPreviewQuery,
  now: Date = new Date(),
): Promise<StalledPreviewDto> {
  assertCan(user, 'ANALYTICS')
  const scope = universityScope(user)
  const states = await stalledStates(scope, now)

  const stageNumbers = query.stage ? [query.stage] : MEASURED_STAGES
  const itemOf = (state: StalledState): StalledPreviewItemDto => ({
    cooperationId: state.cooperationId,
    title: state.title,
    stageNumber: state.stageNumber,
    idleDays: state.idleDays,
    href: cooperationHref(state.cooperationId),
  })
  const byIdle = (a: StalledPreviewItemDto, b: StalledPreviewItemDto) =>
    b.idleDays - a.idleDays || a.cooperationId.localeCompare(b.cooperationId)

  const stages: StalledPreviewStageDto[] = stageNumbers.map((stageNumber) => {
    const atStage = states.filter((state) => state.stageNumber === stageNumber)
    const wouldBe = (state: StalledState) => !state.hasOverdue && state.idleDays >= query.days
    const become = atStage.filter((state) => !state.stalledNow && wouldBe(state)).map(itemOf).sort(byIdle)
    const stop = atStage.filter((state) => state.stalledNow && !wouldBe(state)).map(itemOf).sort(byIdle)
    return {
      stageNumber,
      title: STAGE_TITLES.get(stageNumber) ?? `Этап ${stageNumber}`,
      open: atStage.length,
      current: thresholdDto(getStalledThreshold(stageNumber)),
      proposedDays: query.days,
      before: atStage.filter((state) => state.stalledNow).length,
      after: atStage.filter(wouldBe).length,
      becomeStalled: become,
      stopBeingStalled: stop,
    }
  })
  const listed = new Set(stageNumbers)
  return {
    proposedDays: query.days,
    before: stages.reduce((sum, stage) => sum + stage.before, 0),
    after: stages.reduce((sum, stage) => sum + stage.after, 0),
    stages: query.stage ? stages : stages.filter((stage) => stage.open > 0),
    suppressedByOverdue: states.filter(
      (state) => listed.has(state.stageNumber) && state.hasOverdue && state.idleDays >= query.days,
    ).length,
    isMock: states.some((state) => state.isMock),
  }
}

// ─────────────────────────────── Воронка ────────────────────────────────────

function groupOf(row: repo.TimelineRow, groupBy: FunnelQuery['groupBy']): FunnelSubject['group'] {
  switch (groupBy) {
    case 'region':
      return { key: row.university.region, label: row.university.region }
    case 'city':
      return { key: row.university.city, label: row.university.city }
    case 'university':
      return { key: row.university.id, label: row.university.shortName ?? row.university.name }
    case 'product':
      return row.product
        ? { key: row.product.id, label: row.product.name }
        : { key: 'none', label: 'Продукт не выбран' }
    case 'programLevel':
      return { key: row.program.level, label: PROGRAM_LEVEL_LABELS[row.program.level] }
    default:
      return null
  }
}

function inPeriod(timeline: StageTimeline, query: Pick<FunnelQuery, 'from' | 'to'>): boolean {
  if (query.from && timeline.start < new Date(query.from)) return false
  if (query.to && timeline.start >= new Date(query.to)) return false
  return true
}

export async function funnel(user: CurrentUser, query: FunnelQuery, now: Date = new Date()): Promise<FunnelDto> {
  assertCan(user, 'ANALYTICS')
  const rows = await repo.findTimelineRows(universityScope(user))
  const subjects: FunnelSubject[] = []
  for (const row of rows) {
    const timeline = toTimeline(row, now)
    if (!inPeriod(timeline, query)) continue
    subjects.push({ timeline, title: cooperationTitle(row), status: row.status, group: groupOf(row, query.groupBy) })
  }
  const milestones = query.milestones === true
  const result = buildFunnel(subjects, milestones ? MILESTONE_STEPS : STAGE_STEPS)
  return {
    milestones,
    groupBy: query.groupBy ?? null,
    from: query.from ?? null,
    to: query.to ?? null,
    total: result.total,
    steps: result.steps.map((step) => ({
      ...step,
      conversionFromPrevious: step.conversionFromPrevious === null ? null : round4(step.conversionFromPrevious),
      conversionFromStart: step.conversionFromStart === null ? null : round4(step.conversionFromStart),
      dropped: step.dropped.map((item) => ({ ...item, href: cooperationHref(item.cooperationId) })),
    })),
    groups: result.groups.map((group) => ({
      ...group,
      steps: group.steps.map((step) => ({
        ...step,
        conversionFromStart: step.conversionFromStart === null ? null : round4(step.conversionFromStart),
      })),
    })),
    isMock: rows.some((row) => row.isMock),
  }
}

export async function cohorts(user: CurrentUser, now: Date = new Date()): Promise<CohortsDto> {
  assertCan(user, 'ANALYTICS')
  const rows = await repo.findTimelineRows(universityScope(user))
  const timelines = rows.map((row) => toTimeline(row, now))
  return {
    milestone: { key: COHORT_MILESTONE.key, title: COHORT_MILESTONE.title, fromStage: COHORT_MILESTONE.fromStage },
    cohorts: buildCohorts(timelines, COHORT_MILESTONE.fromStage, now).map((cohort) => ({
      ...cohort,
      cells: cohort.cells.map((cell) => ({ ...cell, share: cell.share === null ? null : round4(cell.share) })),
    })),
    isMock: rows.some((row) => row.isMock),
  }
}

// ─────────────────────────── «Система заметила» ─────────────────────────────

/** Инсайты и число проверок — для API и для пульса. Область — как у пользователя. */
export async function computeInsights(scope: { universityId?: string }, now: Date): Promise<InsightsResult> {
  const lookback = new Date(now.getTime() - (ANOMALY_WEEKLY.recent + ANOMALY_WEEKLY.base + 6) * 7 * DAY_MS)
  const [rows, series, historyStart, stalled] = await Promise.all([
    repo.findTimelineRows(scope),
    repo.loadSeriesSource(scope, lookback, now),
    repo.findHistoryStart(scope),
    stalledStates(scope, now),
  ])
  const timelines = rows.map((row) => toTimeline(row, now))
  const summaries = summarizeStages(timelines)
  const subjects: FunnelSubject[] = rows.map((row, index) => ({
    timeline: timelines[index]!,
    title: cooperationTitle(row),
    status: row.status,
    group: null,
  }))
  const byMetric: Record<SeriesMetric, SeriesPoint[]> = {
    new_cooperations: series.newCooperations,
    stage_transitions: series.stageTransitions,
    meetings: series.meetings,
    dismissed_recommendations: series.dismissedRecommendations,
  }
  const stalledNow = stalled.filter((state) => state.stalledNow)
  return buildInsights({
    now,
    historyStart,
    series: byMetric,
    spans: series.cooperationSpans,
    universityLabels: new Map(series.universities.map((row) => [row.id, row.shortName ?? row.name])),
    durations: MEASURED_STAGES.map((stageNumber) => ({
      stageNumber,
      title: STAGE_TITLES.get(stageNumber) ?? `Этап ${stageNumber}`,
      summary: summaries.get(stageNumber)!,
    })),
    stalled: {
      count: stalledNow.length,
      byData: stalledNow.filter((state) => getStalledThreshold(state.stageNumber).source === 'km').length,
    },
    funnel: buildFunnel(subjects, MILESTONE_STEPS),
  })
}

export async function insights(user: CurrentUser, now: Date = new Date()): Promise<InsightDto[]> {
  assertCan(user, 'ANALYTICS')
  return (await computeInsights(universityScope(user), now)).insights
}
