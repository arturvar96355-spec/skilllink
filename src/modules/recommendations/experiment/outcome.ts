/**
 * Исход сигнала (решение 126): сдвинулся ли объект за H дней после сигнала.
 *
 * - Правила по связке: связка перешла на следующий этап — этап, бывший текущим в момент
 *   сигнала, закрыт (завершён или отменён как «не требуется») по истории этапов.
 *   Текущий этап — первый незакрытый (`findCurrentStage`), поэтому закрытие именно
 *   его и есть переход дальше; закрытие параллельного этапа впереди — нет.
 * - Правила по программе и по навыку: по программе (для навыка — по программам,
 *   которым его не хватает) появилась новая связка или встреча.
 *
 * Чистая функция: факты собирает репозиторий, здесь только сравнение времени.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export type OutcomeState = 'success' | 'failure' | 'pending' | 'unsupported'

export type OutcomeEvent = 'stage-advance' | 'cooperation' | 'meeting'

export interface Outcome {
  state: OutcomeState
  /** Дни от сигнала до исхода (дробные); у неудачи и ожидания — null. */
  days: number | null
  event: OutcomeEvent | null
  /** Успех — когда наступил; неудача — когда закрылось окно; ожидание — null. */
  at: Date | null
}

/** Что было на момент сигнала — сохраняется в `context` журнала. */
export interface SignalContext {
  /** Текущий этап связки в момент сигнала. */
  stageNumber?: number | null
  /** Программы, которым не хватает навыка (правило о дефиците). */
  programIds?: string[]
  priority?: string
  /** Доля контроля, с которой назначалась группа. */
  controlShare?: number
  /** Окно исхода H на момент сигнала: смена конфига не переписывает прежние окна. */
  horizonDays?: number
}

export interface SignalForOutcome {
  entityType: string
  entityId: string
  firedAt: Date
  context: SignalContext | null
}

export interface StageClosure {
  stageNumber: number
  at: Date
}

export interface ProgramEvent {
  at: Date
  kind: 'cooperation' | 'meeting'
}

export interface OutcomeFacts {
  /** Закрытия этапов по связкам: id связки → события истории «в COMPLETED / CANCELLED». */
  stageClosures: ReadonlyMap<string, readonly StageClosure[]>
  /** Новые связки и встречи по программам: id программы → события. */
  programEvents: ReadonlyMap<string, readonly ProgramEvent[]>
}

/** Программы, по которым ждём связку или встречу. */
export function programIdsOf(signal: Pick<SignalForOutcome, 'entityType' | 'entityId' | 'context'>): string[] {
  if (signal.entityType === 'EducationalProgram') return [signal.entityId]
  if (signal.entityType === 'Skill') return signal.context?.programIds ?? []
  return []
}

export function evaluateOutcome(
  signal: SignalForOutcome,
  facts: OutcomeFacts,
  now: Date,
  horizonDays: number,
): Outcome {
  const from = signal.firedAt.getTime()
  const windowEnd = from + horizonDays * DAY_MS
  const until = Math.min(windowEnd, now.getTime())
  const inWindow = (at: Date) => at.getTime() > from && at.getTime() <= until

  let first: { at: Date; event: OutcomeEvent } | null = null
  const consider = (at: Date, event: OutcomeEvent) => {
    if (inWindow(at) && (!first || at < first.at)) first = { at, event }
  }

  if (signal.entityType === 'Cooperation') {
    const stageNumber = signal.context?.stageNumber ?? null
    for (const closure of facts.stageClosures.get(signal.entityId) ?? []) {
      // Без известного текущего этапа годится закрытие любого — лучше, чем не считать вовсе.
      if (stageNumber === null || closure.stageNumber === stageNumber) consider(closure.at, 'stage-advance')
    }
  } else if (signal.entityType === 'EducationalProgram' || signal.entityType === 'Skill') {
    for (const programId of programIdsOf(signal)) {
      for (const event of facts.programEvents.get(programId) ?? []) consider(event.at, event.kind)
    }
  } else {
    return { state: 'unsupported', days: null, event: null, at: null }
  }

  const found = first as { at: Date; event: OutcomeEvent } | null
  if (found) {
    return { state: 'success', days: (found.at.getTime() - from) / DAY_MS, event: found.event, at: found.at }
  }
  if (now.getTime() >= windowEnd) return { state: 'failure', days: null, event: null, at: new Date(windowEnd) }
  return { state: 'pending', days: null, event: null, at: null }
}

/**
 * Дни до сдвига для сравнения средних: не сдвинулся за окно — H дней. Так в среднее
 * входят все назначенные, а не только сдвинувшиеся: среднее по одним успехам сравнивало
 * бы группы, отобранные уже после назначения.
 */
export function cappedDays(outcome: Outcome, horizonDays: number): number | null {
  if (outcome.state === 'success') return Math.min(outcome.days ?? horizonDays, horizonDays)
  if (outcome.state === 'failure') return horizonDays
  return null
}
