import { SIGNING_STAGE_NUMBER, WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import type { CooperationStatus } from '@/shared/contracts/enums'
import { TIMELINE_DONE, type StageTimeline } from './stage-timeline'

/**
 * Воронка по этапам и когорты (решение 120). Чистый модуль над хронологиями
 * `stage-timeline.ts`.
 *
 * «Дошла до шага» — текущий этап связки хоть раз был не меньше первого этапа шага.
 * Конверсия от предыдущего = дошли до шага / дошли до предыдущего; от начала —
 * к числу связок в выборке (все они «дошли» до этапа 1). «Отвалились на шаге» —
 * отменённые или приостановленные связки, дальше этого шага не прошедшие.
 */

export interface FunnelStepDef {
  key: string
  title: string
  /** Номер этапа, с которого начинается шаг (14 — «закрыты этапы 1–13»). */
  fromStage: number
}

/** 14 этапов как есть: шаг k — «дошла до этапа k». */
export const STAGE_STEPS: readonly FunnelStepDef[] = WORKFLOW_STAGES.map((stage) => ({
  key: `stage-${stage.number}`,
  title: stage.number === TIMELINE_DONE ? 'Все этапы закрыты' : stage.title,
  fromStage: stage.number,
}))

/**
 * Шесть вех вместо четырнадцати этапов (`milestones=true`). Границы — по фазам
 * конвейера и контрольным точкам: подписанный договор (закрыт этап 6) — главная
 * веха формализации, её же берут когорты.
 */
export const MILESTONE_STEPS: readonly FunnelStepDef[] = [
  { key: 'start', title: 'Начало работы', fromStage: 1 },
  { key: 'meeting-done', title: 'Контакт и встреча пройдены', fromStage: 4 },
  { key: 'signed', title: 'Договор подписан', fromStage: SIGNING_STAGE_NUMBER + 1 },
  { key: 'implemented', title: 'Продукт внедрён, программа обновлена', fromStage: 11 },
  { key: 'classes-done', title: 'Занятия проведены', fromStage: 12 },
  { key: 'done', title: 'Все этапы закрыты', fromStage: TIMELINE_DONE },
]

/** Ключевая веха когорт: договор подписан — этап 6 закрыт, текущий этап дальше 6. */
export const COHORT_MILESTONE: FunnelStepDef = MILESTONE_STEPS.find((step) => step.key === 'signed')!

export interface FunnelSubject {
  timeline: StageTimeline
  title: string
  status: CooperationStatus
  /** Значение разреза (регион, вуз…); null — без разреза. */
  group: { key: string; label: string } | null
}

export interface FunnelDropped {
  cooperationId: string
  title: string
  status: CooperationStatus
}

export interface FunnelStep {
  key: string
  title: string
  fromStage: number
  reached: number
  /** Доля от предыдущего шага; null у первого шага и когда до предыдущего никто не дошёл. */
  conversionFromPrevious: number | null
  conversionFromStart: number | null
  /** Медиана дней от достижения предыдущего шага до этого — среди дошедших. */
  medianDaysFromPrevious: number | null
  /** Сейчас на этом шаге (действующие, дальше не ушли). */
  inProgress: number
  /** Отменены или приостановлены, дальше этого шага не пройдя. */
  droppedCount: number
  dropped: FunnelDropped[]
}

export interface FunnelGroup {
  key: string
  label: string
  total: number
  steps: Array<{ key: string; reached: number; conversionFromStart: number | null }>
}

export interface Funnel {
  total: number
  steps: FunnelStep[]
  groups: FunnelGroup[]
}

const DAY_MS = 24 * 60 * 60 * 1000

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null)

/** Индекс шага, до которого связка дошла (последний шаг с fromStage ≤ maxReached). */
function lastReachedStep(steps: readonly FunnelStepDef[], maxReached: number): number {
  let index = -1
  for (const [position, step] of steps.entries()) {
    if (maxReached >= step.fromStage) index = position
  }
  return index
}

export function buildFunnel(
  subjects: readonly FunnelSubject[],
  steps: readonly FunnelStepDef[],
  options: { droppedLimit: number } = { droppedLimit: 20 },
): Funnel {
  const total = subjects.length
  const reached = steps.map(() => 0)
  const gaps: number[][] = steps.map(() => [])
  const inProgress = steps.map(() => 0)
  const dropped: FunnelDropped[][] = steps.map(() => [])

  for (const subject of subjects) {
    const { timeline } = subject
    const last = lastReachedStep(steps, timeline.maxReached)
    for (let index = 0; index <= last; index += 1) {
      reached[index]! += 1
      if (index === 0) continue
      const at = timeline.reachedAt.get(steps[index]!.fromStage)
      const previous = timeline.reachedAt.get(steps[index - 1]!.fromStage)
      if (at && previous) gaps[index]!.push(Math.max(0, (at.getTime() - previous.getTime()) / DAY_MS))
    }
    if (last < 0) continue
    // Где связка сейчас: последний шаг, до которого дошёл её текущий этап.
    const currentStep = lastReachedStep(steps, timeline.current)
    const stopped = subject.status === 'CANCELLED' || subject.status === 'PAUSED'
    const finished = timeline.current >= TIMELINE_DONE || subject.status === 'COMPLETED'
    if (stopped && !finished) {
      dropped[last]!.push({ cooperationId: timeline.cooperationId, title: subject.title, status: subject.status })
    } else if (!finished && currentStep >= 0) {
      inProgress[currentStep]! += 1
    }
  }

  const result: FunnelStep[] = steps.map((step, index) => {
    const list = [...dropped[index]!].sort(
      (a, b) => a.title.localeCompare(b.title, 'ru') || a.cooperationId.localeCompare(b.cooperationId),
    )
    const days = median(gaps[index]!)
    return {
      key: step.key,
      title: step.title,
      fromStage: step.fromStage,
      reached: reached[index]!,
      conversionFromPrevious: index === 0 ? null : ratio(reached[index]!, reached[index - 1]!),
      conversionFromStart: ratio(reached[index]!, total),
      medianDaysFromPrevious: index === 0 || days === null ? null : Math.round(days * 10) / 10,
      inProgress: inProgress[index]!,
      droppedCount: list.length,
      dropped: list.slice(0, options.droppedLimit),
    }
  })

  const byGroup = new Map<string, { label: string; subjects: FunnelSubject[] }>()
  for (const subject of subjects) {
    if (!subject.group) continue
    const entry = byGroup.get(subject.group.key) ?? { label: subject.group.label, subjects: [] }
    entry.subjects.push(subject)
    byGroup.set(subject.group.key, entry)
  }
  const groups: FunnelGroup[] = [...byGroup.entries()]
    .map(([key, entry]) => {
      const counts = steps.map(() => 0)
      for (const subject of entry.subjects) {
        const last = lastReachedStep(steps, subject.timeline.maxReached)
        for (let index = 0; index <= last; index += 1) counts[index]! += 1
      }
      return {
        key,
        label: entry.label,
        total: entry.subjects.length,
        steps: steps.map((step, index) => ({
          key: step.key,
          reached: counts[index]!,
          conversionFromStart: ratio(counts[index]!, entry.subjects.length),
        })),
      }
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'ru'))

  return { total, steps: result, groups }
}

// ─────────────────────────────── Когорты ────────────────────────────────────

/** Квартал по московскому времени: «2026-Q3» и его порядковый номер. */
export function quarterOf(date: Date): { key: string; index: number } {
  const moscow = new Date(date.getTime() + 3 * 60 * 60 * 1000)
  const year = moscow.getUTCFullYear()
  const quarter = Math.floor(moscow.getUTCMonth() / 3)
  return { key: `${year}-Q${quarter + 1}`, index: year * 4 + quarter }
}

/** Начало квартала с порядковым номером `index` (московская полночь, в UTC). */
export function quarterStart(index: number): Date {
  const year = Math.floor(index / 4)
  const month = (index % 4) * 3
  return new Date(Date.UTC(year, month, 1) - 3 * 60 * 60 * 1000)
}

export interface CohortCell {
  /** Кварталов с начала: 0 — квартал старта. */
  offset: number
  /** Дошли до вехи к концу этого квартала (накопительно). */
  reached: number
  /** reached / размер когорты. У текущего квартала (`complete: false`) — доля «пока». */
  share: number | null
  /** Квартал закончился — число окончательное. Текущий квартал отдаётся с долей «пока». */
  complete: boolean
}

export interface Cohort {
  cohort: string
  size: number
  cells: CohortCell[]
}

/**
 * Когорты «квартал старта × кварталы с начала»: доля связок когорты, дошедших до
 * вехи к концу каждого квартала. Отменённые до вехи остаются в знаменателе — иначе
 * когорта с отменами выглядела бы успешнее. Будущие кварталы не выдаются;
 * текущий — с `complete: false`.
 */
export function buildCohorts(
  timelines: readonly StageTimeline[],
  milestoneStage: number,
  now: Date,
): Cohort[] {
  const nowQuarter = quarterOf(now).index
  const byCohort = new Map<number, { key: string; reachedAt: Array<Date | null> }>()
  for (const timeline of timelines) {
    const quarter = quarterOf(timeline.start)
    const entry = byCohort.get(quarter.index) ?? { key: quarter.key, reachedAt: [] }
    entry.reachedAt.push(timeline.reachedAt.get(milestoneStage) ?? null)
    byCohort.set(quarter.index, entry)
  }
  return [...byCohort.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, entry]) => {
      const cells: CohortCell[] = []
      for (let offset = 0; index + offset <= nowQuarter; offset += 1) {
        const boundary = quarterStart(index + offset + 1)
        const complete = index + offset < nowQuarter
        const reached = entry.reachedAt.filter((at) => at !== null && at < boundary).length
        cells.push({
          offset,
          reached,
          share: entry.reachedAt.length > 0 ? reached / entry.reachedAt.length : null,
          complete,
        })
      }
      return { cohort: entry.key, size: entry.reachedAt.length, cells }
    })
}
