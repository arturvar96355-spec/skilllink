/**
 * Признаки прогноза на момент t и снимки истории для обучения (решение 125).
 *
 * Главное правило — никакой утечки будущего. Признаки считает одна функция
 * `featuresAt`, и получает она не всю историю связки, а её копию, обрезанную
 * по t (`truncateTimeline`): событий позже t в её входе просто нет. Метка
 * («дошла ли до вехи за H дней») считается отдельно по полной истории.
 *
 * Время событий — деловое: дата встречи, время смены статуса этапа или документа,
 * время решения по рекомендации. `createdAt` записей не используется: у перенесённых
 * и демонстрационных данных это время загрузки, а не событие.
 */

import type { DocumentStatus, ProgramLevel, StageStatus } from '@/shared/contracts/enums'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'
import { FORECAST, FORECAST_CAPITAL_REGIONS, type ForecastMilestone } from '@/shared/config/forecast.config'
import type { StageMedians } from './stage-duration'

const DAY_MS = 24 * 60 * 60 * 1000

export interface StageEvent {
  stageNumber: number
  toStatus: StageStatus
  at: Date
}

export interface DocumentEvent {
  documentId: string
  toStatus: DocumentStatus
  at: Date
}

/** История одной связки — всё, из чего считаются признаки. Собирается в forecast.repo.ts. */
export interface CooperationTimeline {
  id: string
  universityId: string
  region: string
  programLevel: ProgramLevel
  /** Начало работы: самая ранняя из дат первого контакта, начала, создания и первого события. */
  startedAt: Date
  /** Когда связку завершили или отменили; null — открыта. */
  closedAt: Date | null
  isMock: boolean
  stageEvents: StageEvent[]
  /** Пункты чек-листа: этап и время отметки (null — не отмечен). */
  tasks: Array<{ stageNumber: number; doneAt: Date | null }>
  meetings: Date[]
  documentEvents: DocumentEvent[]
  /** Когда отклонены рекомендации по связке. */
  dismissedRecommendations: Date[]
}

/** Соседи по вузу: для признака «сколько ещё действующих связок у вуза». */
export interface PeerCooperation {
  id: string
  startedAt: Date
  closedAt: Date | null
}

export const FEATURE_KEYS = [
  'stageNumber',
  'stageDurationRatio',
  'meetings30',
  'meetings90',
  'daysSinceActivity',
  'stageTasksDoneShare',
  'documentsInReview',
  'regionCapital',
  'levelSpo',
  'levelMaster',
  'universityActiveCooperations',
  'hadBlock',
  'dismissedRecommendations',
] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]
export type FeatureVector = Record<FeatureKey, number>

/** Названия признаков — для страницы модели и объяснений. */
export const FEATURE_TITLES: Record<FeatureKey, string> = {
  stageNumber: 'Номер текущего этапа',
  stageDurationRatio: 'Дней на текущем этапе к медиане этапа',
  meetings30: 'Встреч за 30 дней',
  meetings90: 'Встреч за 90 дней',
  daysSinceActivity: 'Дней с последней активности',
  stageTasksDoneShare: 'Доля закрытых пунктов текущего этапа',
  documentsInReview: 'Есть документы на согласовании',
  regionCapital: 'Вуз в Москве или Санкт-Петербурге',
  levelSpo: 'Программа СПО',
  levelMaster: 'Программа магистратуры или аспирантуры',
  universityActiveCooperations: 'Других действующих связок у вуза',
  hadBlock: 'Этапы связки уже блокировались',
  dismissedRecommendations: 'Отклонённых рекомендаций по связке',
}

const byTime = <T extends { at: Date }>(a: T, b: T) => a.at.getTime() - b.at.getTime()

/**
 * Копия истории, какой она была в момент t: события позже t выброшены,
 * закрытие позже t — ещё не случилось. Признаки считаются только от неё.
 */
export function truncateTimeline(timeline: CooperationTimeline, t: Date): CooperationTimeline {
  const time = t.getTime()
  const before = (date: Date) => date.getTime() <= time
  return {
    ...timeline,
    closedAt: timeline.closedAt && before(timeline.closedAt) ? timeline.closedAt : null,
    stageEvents: timeline.stageEvents.filter((event) => before(event.at)),
    tasks: timeline.tasks.map((task) => ({
      stageNumber: task.stageNumber,
      doneAt: task.doneAt && before(task.doneAt) ? task.doneAt : null,
    })),
    meetings: timeline.meetings.filter(before),
    documentEvents: timeline.documentEvents.filter((event) => before(event.at)),
    dismissedRecommendations: timeline.dismissedRecommendations.filter(before),
  }
}

/** Статусы этапов по последнему событию каждого этапа (история уже обрезана). */
export function stageStatuses(timeline: CooperationTimeline): Map<number, StageStatus> {
  const statuses = new Map<number, StageStatus>()
  for (const event of [...timeline.stageEvents].sort(byTime)) statuses.set(event.stageNumber, event.toStatus)
  return statuses
}

const isClosed = (status: StageStatus | undefined) => status === 'COMPLETED' || status === 'CANCELLED'

/** Текущий этап — первый из 1–13, который не завершён и не отменён (правило решения 5). */
export function currentStageOf(statuses: ReadonlyMap<number, StageStatus>): number | null {
  for (let stage = 1; stage < CONTROL_STAGE_NUMBER; stage += 1) {
    if (!isClosed(statuses.get(stage))) return stage
  }
  return null
}

/**
 * Когда этап стал текущим: когда закрылся последний из предыдущих этапов
 * (для первого — начало связки). История уже обрезана.
 */
export function becameCurrentAt(timeline: CooperationTimeline, stage: number): Date {
  let latest = timeline.startedAt.getTime()
  const lastClose = new Map<number, number>()
  for (const event of [...timeline.stageEvents].sort(byTime)) {
    if (event.stageNumber >= stage) continue
    if (isClosed(event.toStatus)) lastClose.set(event.stageNumber, event.at.getTime())
  }
  for (const time of lastClose.values()) latest = Math.max(latest, time)
  return new Date(latest)
}

export function isMilestoneReached(timeline: CooperationTimeline, stageNumber: number): boolean {
  return stageStatuses(timeline).get(stageNumber) === 'COMPLETED'
}

const days = (from: Date, to: Date) => Math.max(0, (to.getTime() - from.getTime()) / DAY_MS)

/**
 * Признаки связки на момент t. На вход — история, УЖЕ обрезанная по t: функция
 * физически не видит будущего. `peers` — другие связки того же вуза (тоже на t).
 * null — у связки нет текущего этапа (все 1–13 закрыты).
 */
export function featuresAt(
  timeline: CooperationTimeline,
  peers: readonly PeerCooperation[],
  t: Date,
  medians: StageMedians,
): FeatureVector | null {
  const statuses = stageStatuses(timeline)
  const stage = currentStageOf(statuses)
  if (stage === null) return null

  const onStageDays = days(becameCurrentAt(timeline, stage), t)
  const median = Math.max(medians.medianDays(stage), 1)

  const activity: number[] = [
    timeline.startedAt.getTime(),
    ...timeline.stageEvents.map((event) => event.at.getTime()),
    ...timeline.meetings.map((date) => date.getTime()),
    ...timeline.documentEvents.map((event) => event.at.getTime()),
    ...timeline.tasks.flatMap((task) => (task.doneAt ? [task.doneAt.getTime()] : [])),
    ...timeline.dismissedRecommendations.map((date) => date.getTime()),
  ]
  const lastActivity = new Date(Math.max(...activity))

  const stageTasks = timeline.tasks.filter((task) => task.stageNumber === stage)
  const tasksDone = stageTasks.filter((task) => task.doneAt !== null).length

  const documentStatus = new Map<string, DocumentStatus>()
  for (const event of [...timeline.documentEvents].sort(byTime)) documentStatus.set(event.documentId, event.toStatus)

  const since = (daysBack: number) => t.getTime() - daysBack * DAY_MS
  const activePeers = peers.filter(
    (peer) =>
      peer.id !== timeline.id &&
      peer.startedAt.getTime() <= t.getTime() &&
      (peer.closedAt === null || peer.closedAt.getTime() > t.getTime()),
  ).length

  return {
    stageNumber: stage,
    stageDurationRatio: Math.min(onStageDays / median, FORECAST.capStageRatio),
    meetings30: timeline.meetings.filter((date) => date.getTime() > since(30)).length,
    meetings90: timeline.meetings.filter((date) => date.getTime() > since(90)).length,
    daysSinceActivity: Math.min(days(lastActivity, t), FORECAST.capDays),
    stageTasksDoneShare: stageTasks.length > 0 ? tasksDone / stageTasks.length : 0,
    documentsInReview: [...documentStatus.values()].includes('REVIEW') ? 1 : 0,
    regionCapital: FORECAST_CAPITAL_REGIONS.includes(timeline.region) ? 1 : 0,
    levelSpo: timeline.programLevel === 'SPO' ? 1 : 0,
    levelMaster: timeline.programLevel === 'MASTER' || timeline.programLevel === 'POSTGRADUATE' ? 1 : 0,
    universityActiveCooperations: activePeers,
    hadBlock: timeline.stageEvents.some((event) => event.toStatus === 'BLOCKED') ? 1 : 0,
    dismissedRecommendations: timeline.dismissedRecommendations.length,
  }
}

export function toRow(features: FeatureVector): number[] {
  return FEATURE_KEYS.map((key) => features[key])
}

/**
 * Годится ли связка в момент t для прогноза к вехе: уже начата, ещё не закрыта,
 * веха не достигнута, предыдущая веха (если есть) достигнута. История обрезана по t.
 */
export function isEligible(
  truncated: CooperationTimeline,
  t: Date,
  milestone: ForecastMilestone,
  previousMilestone: ForecastMilestone | null,
): boolean {
  if (truncated.startedAt.getTime() > t.getTime()) return false
  if (truncated.closedAt !== null) return false
  const statuses = stageStatuses(truncated)
  if (statuses.get(milestone.stageNumber) === 'COMPLETED') return false
  if (previousMilestone && statuses.get(previousMilestone.stageNumber) !== 'COMPLETED') return false
  return currentStageOf(statuses) !== null
}

/** Метка: этап вехи завершён в полуинтервале (t; t + H]. Считается по ПОЛНОЙ истории. */
export function labelAt(timeline: CooperationTimeline, t: Date, milestone: ForecastMilestone): 0 | 1 {
  const from = t.getTime()
  const to = from + milestone.horizonDays * DAY_MS
  return timeline.stageEvents.some(
    (event) =>
      event.stageNumber === milestone.stageNumber &&
      event.toStatus === 'COMPLETED' &&
      event.at.getTime() > from &&
      event.at.getTime() <= to,
  )
    ? 1
    : 0
}

export interface SnapshotPoint {
  cooperationId: string
  universityId: string
  at: Date
  label: 0 | 1
  timeline: CooperationTimeline
}

export interface Snapshot extends SnapshotPoint {
  features: FeatureVector
}

/** Соседи по вузу, какими они были в момент t. */
export function peersAt(timelines: readonly CooperationTimeline[], universityId: string): PeerCooperation[] {
  return timelines
    .filter((item) => item.universityId === universityId)
    .map((item) => ({ id: item.id, startedAt: item.startedAt, closedAt: item.closedAt }))
}

function truncatePeers(peers: readonly PeerCooperation[], t: Date): PeerCooperation[] {
  return peers.map((peer) => ({
    ...peer,
    closedAt: peer.closedAt && peer.closedAt.getTime() <= t.getTime() ? peer.closedAt : null,
  }))
}

/**
 * Даты снимков — скользящее окно с шагом `stepDays` назад от последней даты,
 * у которой метка уже известна (now − H). Более поздние снимки не берутся:
 * их исход ещё не наступил (правое цензурирование).
 */
export function snapshotDates(timelines: readonly CooperationTimeline[], now: Date, milestone: ForecastMilestone): Date[] {
  if (timelines.length === 0) return []
  const last = now.getTime() - milestone.horizonDays * DAY_MS
  const first = Math.min(...timelines.map((item) => item.startedAt.getTime()))
  const dates: Date[] = []
  for (let time = last; time >= first; time -= FORECAST.snapshotStepDays * DAY_MS) dates.push(new Date(time))
  return dates.reverse()
}

/** Точки обучения: (связка, дата) с меткой. Признаки считаются позже — от медиан на нужную дату. */
export function snapshotPoints(
  timelines: readonly CooperationTimeline[],
  now: Date,
  milestone: ForecastMilestone,
  previousMilestone: ForecastMilestone | null,
): SnapshotPoint[] {
  const points: SnapshotPoint[] = []
  for (const at of snapshotDates(timelines, now, milestone)) {
    for (const timeline of timelines) {
      const truncated = truncateTimeline(timeline, at)
      if (!isEligible(truncated, at, milestone, previousMilestone)) continue
      points.push({
        cooperationId: timeline.id,
        universityId: timeline.universityId,
        at,
        label: labelAt(timeline, at, milestone),
        timeline,
      })
    }
  }
  return points
}

/** Признаки для точек: история и соседи обрезаются по дате снимка. */
export function featurize(
  points: readonly SnapshotPoint[],
  timelines: readonly CooperationTimeline[],
  medians: StageMedians,
): Snapshot[] {
  const peersByUniversity = new Map<string, PeerCooperation[]>()
  for (const timeline of timelines) {
    if (!peersByUniversity.has(timeline.universityId)) {
      peersByUniversity.set(timeline.universityId, peersAt(timelines, timeline.universityId))
    }
  }
  const snapshots: Snapshot[] = []
  for (const point of points) {
    const truncated = truncateTimeline(point.timeline, point.at)
    const peers = truncatePeers(peersByUniversity.get(point.universityId) ?? [], point.at)
    const features = featuresAt(truncated, peers, point.at, medians)
    if (features) snapshots.push({ ...point, features })
  }
  return snapshots
}

/** Признаки связки «сейчас» — для прогноза и для PSI. */
export function currentFeatures(
  timeline: CooperationTimeline,
  peers: readonly PeerCooperation[],
  now: Date,
  medians: StageMedians,
): FeatureVector | null {
  return featuresAt(truncateTimeline(timeline, now), truncatePeers(peers, now), now, medians)
}
