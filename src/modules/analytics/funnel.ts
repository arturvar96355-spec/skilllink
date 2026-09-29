import { SIGNING_STAGE_NUMBER, WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import { STAGE_PHASES, type CooperationStatus, type StagePhase } from '@/shared/contracts/enums'
import { TIMELINE_DONE, TIMELINE_LAST_STAGE, type StageTimeline } from './stage-timeline'

/**
 * Воронка по этапам (решение 120). Чистый модуль над хронологиями
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
 * конвейера и контрольным точкам: подписанный договор (этап 6 завершён) — главная
 * веха формализации. «Дошла до вехи» — пройдены все этапы до
 * неё; отменённый обязательный этап пройденным не считается (решение 227), поэтому
 * отменённое подписание — не «Договор подписан», отменённые занятия — не «Занятия проведены».
 */
export const MILESTONE_STEPS: readonly FunnelStepDef[] = [
  { key: 'start', title: 'Начало работы', fromStage: 1 },
  { key: 'meeting-done', title: 'Контакт и встреча пройдены', fromStage: 4 },
  { key: 'signed', title: 'Договор подписан', fromStage: SIGNING_STAGE_NUMBER + 1 },
  { key: 'implemented', title: 'Продукт внедрён, программа обновлена', fromStage: 11 },
  { key: 'classes-done', title: 'Занятия проведены', fromStage: 12 },
  { key: 'done', title: 'Все этапы закрыты', fromStage: TIMELINE_DONE },
]


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

/** Выбывшие по статусу: связка выбывает, только когда она на паузе или отменена. */
export interface DroppedByStatus {
  PAUSED: number
  CANCELLED: number
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
  /**
   * Все выбывшие по статусу и по фазе, где выбыли (решение 227): считаются по полному
   * списку, а `steps[].dropped` — превью до `droppedLimit` на шаг. Суммы сходятся
   * с суммой `droppedCount`.
   */
  droppedByStatus: DroppedByStatus
  droppedByPhase: Record<StagePhase, number>
}

const PHASE_BY_STAGE = new Map(WORKFLOW_STAGES.map((stage) => [stage.number, stage.phase]))

/**
 * Этап, где связка выбыла (решение 215): самый дальний достигнутый, 1–13 — этап 14
 * закрывает система, выбыть на нём нельзя. Один расчёт для строки списка и для сводки.
 */
export function droppedStageNumber(timeline: Pick<StageTimeline, 'maxReached'>): number {
  return Math.min(Math.max(timeline.maxReached, 1), TIMELINE_LAST_STAGE)
}

export function droppedPhase(timeline: Pick<StageTimeline, 'maxReached'>): StagePhase {
  return PHASE_BY_STAGE.get(droppedStageNumber(timeline)) ?? 'ATTRACTION'
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
  const droppedByStatus: DroppedByStatus = { PAUSED: 0, CANCELLED: 0 }
  const droppedByPhase = Object.fromEntries(STAGE_PHASES.map((phase) => [phase, 0])) as Record<StagePhase, number>

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
      droppedByStatus[subject.status as keyof DroppedByStatus] += 1
      droppedByPhase[droppedPhase(timeline)] += 1
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

  return { total, steps: result, groups, droppedByStatus, droppedByPhase }
}

/** Запись журнала о правке связки: `payload` — `{ status }` (сид) или `{ fields: [...] }` (приложение). */
export interface CooperationUpdateRecord {
  payload: unknown
  createdAt: Date
}

/**
 * Когда связка получила свой статус (решение 215): самая поздняя правка, в которой
 * менялся статус. Сид пишет `{ status: 'PAUSED' }`, приложение — список полей
 * `{ fields: ['status', …] }` без значения; подходит и то и другое. Записи — от новых
 * к старым. Нет такой записи — null: дата не выдумывается.
 */
export function statusChangedAt(updates: readonly CooperationUpdateRecord[], status: CooperationStatus): Date | null {
  for (const update of updates) {
    const payload = update.payload
    if (!payload || typeof payload !== 'object') continue
    const record = payload as { status?: unknown; fields?: unknown }
    if (record.status === status) return update.createdAt
    if (record.status === undefined && Array.isArray(record.fields) && record.fields.includes('status')) {
      return update.createdAt
    }
  }
  return null
}
