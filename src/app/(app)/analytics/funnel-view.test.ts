import { describe, expect, it } from 'vitest'
import type { CooperationListItemDto, FunnelDroppedDto, StagePhase } from '@/shared/contracts'
import type { FunnelStep } from '@/ui/data/Funnel'
import {
  composition,
  currentByPhase,
  DONE,
  funnelConclusion,
  funnelRows,
  narrowest,
  sortDropped,
  transitions,
} from './funnel-view'

const step = (key: string, label: string, value: number): FunnelStep => ({ key, label, value, detail: '' })

const STEPS = [
  step('ATTRACTION', 'Привлечение', 77),
  step('FORMALIZATION', 'Оформление', 58),
  step('IMPLEMENTATION', 'Внедрение', 38),
  step('OPERATION', 'Эксплуатация', 17),
  step('CONTROL', 'Контроль', 6),
]

function dropped(phase: StagePhase, stageNumber: number, status: 'PAUSED' | 'CANCELLED', stoppedAt: string | null, title = 'x'): FunnelDroppedDto {
  return {
    cooperationId: `${title}-${stageNumber}`,
    title,
    status,
    href: '/cooperations/x',
    stageNumber,
    stageTitle: `Этап ${stageNumber}`,
    phase,
    stoppedAt,
    stoppedAtBasis: stoppedAt ? 'status' : null,
    reason: null,
  }
}

describe('вкладка «Воронка» (решение 215)', () => {
  it('переходы между соседними фазами — доля от прошлой фазы; «Контроль» не сравнивается', () => {
    const list = transitions(STEPS)
    expect(list.map((item) => item.share)).toEqual([75, 66, 45])
    expect(narrowest(list)?.to).toBe('Эксплуатация')
  })

  it('до фазы никто не дошёл — перехода нет, деления на ноль нет', () => {
    const list = transitions([step('ATTRACTION', 'А', 0), step('FORMALIZATION', 'Б', 0)])
    expect(list).toEqual([])
    expect(narrowest(list)).toBeNull()
  })

  it('вывод одной фразой: где выбывают больше всего и самый узкий переход', () => {
    const text = funnelConclusion(STEPS, [
      dropped('FORMALIZATION', 4, 'PAUSED', null),
      dropped('FORMALIZATION', 6, 'CANCELLED', null),
      dropped('ATTRACTION', 2, 'CANCELLED', null),
    ])
    expect(text).toBe(
      'Больше всего связок выбывает на фазе «Оформление»: 2 из 3; самый узкий переход — «Внедрение» → «Эксплуатация»: дальше прошли 17 из 38 (45 %).',
    )
  })

  it('полосы: число «из всех» на полосе, переход над ней, узкий — красным', () => {
    const rows = funnelRows(STEPS, new Map([['ATTRACTION', 19], [DONE, 6]]), new Map([['ATTRACTION', 5]]))
    expect(rows[0]!.valueText).toBe('77 из 77 · 100 %')
    expect(rows[0]!.note).toBe('сейчас здесь 19 · выбыли 5')
    expect(rows[0]!.between).toBeUndefined()
    expect(rows[3]!.between).toEqual({ text: '45 % перешли дальше — самый узкий переход', tone: 'danger' })
    expect(rows[4]!.between?.text).toBe('35 % прошли весь цикл')
    expect(rows[4]!.note).toBe('все этапы пройдены у 6')
    expect(rows.map((row) => row.shade)).toEqual([0, 1, 2, 3, 4])
  })

  it('состав базы — те же статусы, что на главной', () => {
    const items = ['DRAFT', 'ACTIVE', 'ACTIVE', 'PAUSED', 'COMPLETED'].map(
      (status) => ({ status, currentStage: null }) as unknown as CooperationListItemDto,
    )
    expect(composition(items)).toEqual({ active: 3, paused: 1, completed: 1 })
    expect(currentByPhase(items).get(DONE)).toBe(5)
  })

  it('выбывшие — по порядку воронки, внутри этапа свежие выше', () => {
    const sorted = sortDropped([
      dropped('FORMALIZATION', 4, 'PAUSED', '2026-07-01T00:00:00Z', 'b'),
      dropped('ATTRACTION', 2, 'CANCELLED', '2026-05-01T00:00:00Z', 'a'),
      dropped('FORMALIZATION', 4, 'CANCELLED', '2026-09-01T00:00:00Z', 'c'),
    ])
    expect(sorted.map((item) => item.title)).toEqual(['a', 'c', 'b'])
  })
})
