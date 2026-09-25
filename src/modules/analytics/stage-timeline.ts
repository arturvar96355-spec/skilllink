import type { CooperationStatus, StageStatus } from '@/shared/contracts/enums'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'
import { durationDays, type SurvivalObservation } from './survival'

/**
 * Хронология «текущего этапа» связки, восстановленная из истории этапов
 * (решение 120). Чистый модуль.
 *
 * Отдельной таблицы переходов нет и не нужно: каждая смена статуса этапа уже
 * пишется в `stage_history` с временем (решение 4), и заводить вторую запись того
 * же события — значит однажды получить две разные правды. Текущий этап — первый
 * по номеру незакрытый (не COMPLETED и не CANCELLED) среди 1–13 (решение 5); этап 14
 * вычисляемый и в хронологию не входит: «дошла до 14» значит «закрыты 1–13».
 *
 * Хронология проигрывает историю по времени: после каждой пачки записей с одним
 * временем пересчитывается текущий этап. Смена текущего этапа — переход.
 * Параллельно закрытые этапы дают прыжок (4 → 7): этапы 5 и 6 «достигнуты», но
 * текущими не были, и наблюдений длительности по ним нет.
 */

export const TIMELINE_LAST_STAGE = CONTROL_STAGE_NUMBER - 1
/** «Дошла до 14» — все этапы 1–13 закрыты. */
export const TIMELINE_DONE = CONTROL_STAGE_NUMBER

export interface TimelineStageInput {
  stageNumber: number
  status: StageStatus
  completedAt: Date | null
  history: ReadonlyArray<{ toStatus: StageStatus; changedAt: Date }>
}

export interface TimelineCooperationInput {
  id: string
  status: CooperationStatus
  startedAt: Date | null
  createdAt: Date
  closedAt: Date | null
  updatedAt: Date
  stages: readonly TimelineStageInput[]
}

export interface StageTransition {
  from: number
  to: number
  at: Date
}

export interface StageTimeline {
  cooperationId: string
  status: CooperationStatus
  /** Вход в этап 1: начало работы по связке. */
  start: Date
  /**
   * Конец наблюдения: у действующей — «сейчас», у приостановленной — последнее
   * известное движение, у закрытой — дата закрытия.
   */
  end: Date
  transitions: StageTransition[]
  /** Первый момент, когда текущий этап стал ≥ k (k = 1..14). */
  reachedAt: Map<number, Date>
  /** Первый момент, когда этап k стал текущим. */
  enteredAt: Map<number, Date>
  /** Первый момент после входа, когда текущий этап ушёл дальше k. */
  exitedAt: Map<number, Date>
  /** Самый дальний этап, до которого дошла связка (14 — закрыты все 1–13). */
  maxReached: number
  /** Текущий этап на конец наблюдения (14 — все закрыты). */
  current: number
}

const isClosed = (status: StageStatus): boolean => status === 'COMPLETED' || status === 'CANCELLED'

function currentOf(statuses: ReadonlyMap<number, StageStatus>): number {
  for (let stage = 1; stage <= TIMELINE_LAST_STAGE; stage += 1) {
    if (!isClosed(statuses.get(stage) ?? 'NOT_STARTED')) return stage
  }
  return TIMELINE_DONE
}

/** Конец наблюдения по статусу связки. */
function observationEnd(input: TimelineCooperationInput, lastEventAt: Date | null, now: Date): Date {
  let end: Date
  switch (input.status) {
    case 'COMPLETED':
    case 'CANCELLED':
      end = input.closedAt ?? input.updatedAt
      break
    case 'PAUSED': {
      // Даты постановки на паузу в модели нет: берётся последнее известное движение —
      // правка связки или смена статуса этапа (этапы updatedAt связки не трогают).
      end = lastEventAt && lastEventAt > input.updatedAt ? lastEventAt : input.updatedAt
      break
    }
    default:
      end = now
  }
  return end > now ? now : end
}

export function buildStageTimeline(input: TimelineCooperationInput, now: Date): StageTimeline {
  type Event = { stageNumber: number; toStatus: StageStatus; at: number }
  const events: Event[] = []
  for (const stage of input.stages) {
    if (stage.stageNumber < 1 || stage.stageNumber > TIMELINE_LAST_STAGE) continue
    for (const entry of stage.history) {
      events.push({ stageNumber: stage.stageNumber, toStatus: entry.toStatus, at: entry.changedAt.getTime() })
    }
    // Этап закрыт, а в истории закрытия нет (данные до истории, ручная правка):
    // время берётся из completedAt, иначе связка навсегда «застряла» бы на нём.
    const last = [...stage.history].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime()).at(-1)
    if (stage.status === 'COMPLETED' && stage.completedAt && last?.toStatus !== 'COMPLETED') {
      events.push({ stageNumber: stage.stageNumber, toStatus: 'COMPLETED', at: stage.completedAt.getTime() })
    }
  }
  events.sort((a, b) => a.at - b.at || a.stageNumber - b.stageNumber)

  const firstEvent = events[0]?.at
  const startMs = Math.min(
    (input.startedAt ?? input.createdAt).getTime(),
    firstEvent ?? Number.POSITIVE_INFINITY,
  )
  const start = new Date(startMs)
  const end = observationEnd(input, events.length > 0 ? new Date(events.at(-1)!.at) : null, now)

  const statuses = new Map<number, StageStatus>()
  const transitions: StageTransition[] = []
  const reachedAt = new Map<number, Date>([[1, start]])
  const enteredAt = new Map<number, Date>([[1, start]])
  const exitedAt = new Map<number, Date>()
  let current = 1
  let maxReached = 1

  const moveTo = (next: number, at: Date) => {
    transitions.push({ from: current, to: next, at })
    if (next > current) {
      for (let stage = current; stage < next; stage += 1) {
        if (enteredAt.has(stage) && !exitedAt.has(stage)) exitedAt.set(stage, at)
      }
    }
    for (let stage = maxReached + 1; stage <= next; stage += 1) reachedAt.set(stage, at)
    if (!enteredAt.has(next) && next <= TIMELINE_LAST_STAGE) enteredAt.set(next, at)
    maxReached = Math.max(maxReached, next)
    current = next
  }

  let index = 0
  while (index < events.length) {
    const at = events[index]!.at
    if (at > end.getTime()) break
    while (index < events.length && events[index]!.at === at) {
      statuses.set(events[index]!.stageNumber, events[index]!.toStatus)
      index += 1
    }
    const next = currentOf(statuses)
    if (next !== current) moveTo(next, new Date(at))
  }

  return {
    cooperationId: input.id,
    status: input.status,
    start,
    end,
    transitions,
    reachedAt,
    enteredAt,
    exitedAt,
    maxReached,
    current,
  }
}

/**
 * Наблюдение длительности этапа по одной связке: от первого входа в этап до первого
 * выхода вперёд (событие) либо до конца наблюдения (цензура). Возврат назад
 * (переоткрыли предыдущий этап) выходом не считается: время на этапе продолжает идти.
 * null — связка в этап не входила (не дошла или перепрыгнула его).
 */
export function stageObservation(timeline: StageTimeline, stage: number): SurvivalObservation | null {
  const entered = timeline.enteredAt.get(stage)
  if (!entered) return null
  const exited = timeline.exitedAt.get(stage)
  if (exited) return { days: durationDays(entered.getTime(), exited.getTime(), true), event: true }
  return { days: durationDays(entered.getTime(), timeline.end.getTime(), false), event: false }
}

/** Все наблюдения этапа по набору связок. */
export function stageObservations(timelines: readonly StageTimeline[], stage: number): SurvivalObservation[] {
  const result: SurvivalObservation[] = []
  for (const timeline of timelines) {
    const observation = stageObservation(timeline, stage)
    if (observation) result.push(observation)
  }
  return result
}
