import {
  STAGE_PHASES,
  STAGE_PHASE_LABELS,
  type CooperationListItemDto,
  type FunnelDroppedDto,
  type StagePhase,
} from '@/shared/contracts'
import type { MeasureBarRow } from '@/ui/data/MeasureBars'
import type { FunnelStep } from '@/ui/data/Funnel'
import { formatNumber, pluralize } from '@/ui/lib/format'

/**
 * Вкладка «Воронка» аналитики (решение 215): переходы между фазами и выбывшие.
 *
 * База подсчёта — та же, что у воронки главной: связки без отменённых
 * (`PHASE_FUNNEL_PATH`, `phaseFunnel`). Отменённые в воронку не входят и видны
 * только в списке выбывших — так «77 связок» на главной и здесь одно число.
 */

/** Последняя фаза — «Контроль»: этап 14 закрывает система, когда пройдены все остальные. */
const FINAL_PHASE: StagePhase = 'CONTROL'

/** Доля целым процентом: «66 %». */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null
}

export interface Transition {
  from: string
  to: string
  passed: number
  of: number
  /** Доля дошедших до следующей фазы, 0..100. */
  share: number
}

/**
 * Переходы между соседними фазами рабочего цикла. У перехода, куда никто не дошёл,
 * доли нет — его нет в списке. Переход в «Контроль» не сравнивается с остальными:
 * туда попадают только связки, прошедшие все этапы, — это вопрос времени, а не потеря.
 */
export function transitions(steps: readonly FunnelStep[]): Transition[] {
  const result: Transition[] = []
  for (let index = 1; index < steps.length; index += 1) {
    const previous = steps[index - 1]!
    const current = steps[index]!
    if (current.key === FINAL_PHASE) continue
    const share = percent(current.value, previous.value)
    if (share === null) continue
    result.push({ from: previous.label, to: current.label, passed: current.value, of: previous.value, share })
  }
  return result
}

/** Самый узкий переход; при равенстве — более ранний: там связка теряется раньше. */
export function narrowest(list: readonly Transition[]): Transition | null {
  let best: Transition | null = null
  for (const item of list) if (!best || item.share < best.share) best = item
  return best
}

/** Сколько выбывших на каждой фазе — по фазе этапа, дальше которого связка не ушла. */
export function droppedByPhase(dropped: readonly FunnelDroppedDto[]): Map<StagePhase, number> {
  const counts = new Map<StagePhase, number>()
  for (const item of dropped) counts.set(item.phase, (counts.get(item.phase) ?? 0) + 1)
  return counts
}

/** Состав базы: «65 активных, 6 на паузе, 6 завершённых» — по тем же статусам, что на главной. */
export function composition(list: readonly CooperationListItemDto[]): {
  active: number
  paused: number
  completed: number
} {
  let active = 0
  let paused = 0
  let completed = 0
  for (const item of list) {
    if (item.status === 'PAUSED') paused += 1
    else if (item.status === 'COMPLETED') completed += 1
    else if (item.status === 'DRAFT' || item.status === 'ACTIVE') active += 1
  }
  return { active, paused, completed }
}

export function compositionText(counts: { active: number; paused: number; completed: number }): string {
  const parts = [`${formatNumber(counts.active)} ${pluralize(counts.active, ['активная', 'активные', 'активных'])}`]
  if (counts.paused > 0) parts.push(`${formatNumber(counts.paused)} на паузе`)
  if (counts.completed > 0) {
    parts.push(
      `${formatNumber(counts.completed)} ${pluralize(counts.completed, ['завершённая', 'завершённые', 'завершённых'])}`,
    )
  }
  return parts.join(', ')
}

/**
 * Вывод одной фразой: где выбывает больше всего и какой переход самый узкий.
 * Узкий переход — не обязательно потеря: там же и связки, которые ещё в работе,
 * поэтому фраза говорит «дальше прошли», а не «потеряли».
 */
export function funnelConclusion(steps: readonly FunnelStep[], dropped: readonly FunnelDroppedDto[]): string {
  const narrow = narrowest(transitions(steps))
  const byPhase = droppedByPhase(dropped)
  let worstPhase: StagePhase | null = null
  for (const phase of STAGE_PHASES) {
    if ((byPhase.get(phase) ?? 0) > (worstPhase ? byPhase.get(worstPhase) ?? 0 : 0)) worstPhase = phase
  }
  const parts: string[] = []
  if (worstPhase) {
    const count = byPhase.get(worstPhase) ?? 0
    parts.push(
      `Больше всего связок выбывает на фазе «${STAGE_PHASE_LABELS[worstPhase]}»: ${formatNumber(count)} из ${formatNumber(dropped.length)}`,
    )
  }
  if (narrow) {
    parts.push(
      `самый узкий переход — «${narrow.from}» → «${narrow.to}»: дальше прошли ${formatNumber(narrow.passed)} из ${formatNumber(narrow.of)} (${narrow.share} %)`,
    )
  }
  if (parts.length === 0) return 'Связок в воронке пока нет.'
  const sentence = parts.join('; ')
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

/**
 * Полосы воронки: фаза — полоса «дошли из всех», над ней — доля перехода
 * от предыдущей фазы. Фазы — светлотой одного тона; самый узкий переход — красным
 * (требует внимания). Справа — сколько связок сейчас на фазе и сколько выбыло на ней.
 */
export function funnelRows(
  steps: readonly FunnelStep[],
  here: ReadonlyMap<string, number>,
  byPhase: ReadonlyMap<StagePhase, number>,
): MeasureBarRow[] {
  const total = steps[0]?.value ?? 0
  const narrow = narrowest(transitions(steps))
  return steps.map((step, index) => {
    const previous = steps[index - 1]
    const share = previous ? percent(step.value, previous.value) : null
    const isNarrow = narrow !== null && previous !== undefined && narrow.to === step.label && narrow.from === previous.label
    const current = here.get(step.key) ?? 0
    const out = byPhase.get(step.key as StagePhase) ?? 0
    const isFinal = step.key === FINAL_PHASE
    const done = isFinal ? (here.get(DONE) ?? 0) : 0
    const notes: string[] = []
    if (!isFinal || current > 0) notes.push(`сейчас здесь ${formatNumber(current)}`)
    if (done > 0) notes.push(`все этапы пройдены у ${formatNumber(done)}`)
    if (out > 0) notes.push(`выбыли ${formatNumber(out)}`)
    return {
      key: step.key,
      label: step.label,
      value: step.value,
      valueText: `${formatNumber(step.value)} из ${formatNumber(total)} · ${percent(step.value, total) ?? 0} %`,
      shade: Math.min(index, 4),
      note: notes.join(' · '),
      between:
        previous === undefined
          ? undefined
          : share === null
            ? { text: 'до прошлой фазы никто не дошёл', tone: 'muted' }
            : isFinal
              ? { text: `${share} % прошли весь цикл`, tone: 'default' }
              : {
                  text: `${share} % перешли дальше${isNarrow ? ' — самый узкий переход' : ''}`,
                  tone: isNarrow ? 'danger' : 'default',
                },
    }
  })
}

/** Ключ связок без текущего этапа — все этапы пройдены. */
export const DONE = 'done'

/** Сколько связок сейчас на каждой фазе; без текущего этапа — под ключом `DONE`. */
export function currentByPhase(list: readonly CooperationListItemDto[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of list) {
    const key = item.currentStage?.phase ?? DONE
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** Выбывшие по порядку воронки: фаза, этап, затем свежие выше. */
export function sortDropped(list: readonly FunnelDroppedDto[]): FunnelDroppedDto[] {
  return [...list].sort(
    (a, b) =>
      STAGE_PHASES.indexOf(a.phase) - STAGE_PHASES.indexOf(b.phase) ||
      a.stageNumber - b.stageNumber ||
      (b.stoppedAt ?? '').localeCompare(a.stoppedAt ?? '') ||
      a.title.localeCompare(b.title, 'ru'),
  )
}
