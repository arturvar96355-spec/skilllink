import { describe, expect, it } from 'vitest'
import type { RecommendationDto } from '@/shared/contracts'
import {
  PRIORITY_ORDER,
  canDismiss,
  groupRecommendations,
  primaryTransition,
  responsibleOf,
  rowValue,
  shortPersonName,
  summarizeRecommendation,
} from './reco-view'

function rec(overrides: Partial<RecommendationDto>): RecommendationDto {
  return {
    id: 'r',
    type: 'ACTION',
    ruleKey: 'unknown.rule',
    title: 'Полный заголовок правила',
    description: '',
    priority: 'HIGH',
    justification: 'Обоснование правила',
    relatedData: null,
    confidence: 'MEDIUM',
    status: 'NEW',
    resolutionComment: null,
    target: { objectType: 'Cooperation', objectId: 'c1', label: 'ДГТУ — Информационная безопасность' },
    cooperationId: 'c1',
    createdAt: '2026-09-27T00:00:00.000Z',
    updatedAt: '2026-09-27T00:00:00.000Z',
    resolvedAt: null,
    score: 0.6,
    scoreBreakdown: null,
    reasons: [],
    isDeferred: false,
    ...overrides,
  }
}

const overdue = rec({
  ruleKey: 'stage.overdue',
  priority: 'CRITICAL',
  title: 'Просрочен этап 10: Обновление образовательной программы',
  justification:
    'Нормативный срок этапа прошёл 101 дн. назад, этап всё ещё в статусе «В работе». Ответственный: Савельева Ольга Дмитриевна.',
  relatedData: { stageNumber: 10, daysOverdue: 101, deadline: '2026-06-18T00:00:00.000Z', status: 'IN_PROGRESS' },
})

describe('короткая строка рекомендации', () => {
  it('просрочка этапа: глагол, связка, этап и срок, ответственный отдельно', () => {
    expect(summarizeRecommendation(overdue)).toEqual({
      title: 'Закрыть этап 10: ДГТУ — Информационная безопасность',
      why: '«Обновление образовательной программы» — срок прошёл 101 дн. назад',
      responsible: 'Савельева Ольга Дмитриевна',
    })
  })

  it('просрочка в день срока — «срок истёк сегодня»', () => {
    const today = { ...overdue, relatedData: { ...overdue.relatedData, daysOverdue: 0 } }
    expect(summarizeRecommendation(today).why).toBe('«Обновление образовательной программы» — срок истёк сегодня')
  })

  it('остальные правила — та же короткая форма, что на главной', () => {
    const stalled = rec({ ruleKey: 'cooperation.stalled', relatedData: { idleDays: 21, thresholdDays: 14, stageNumber: 5 } })
    expect(summarizeRecommendation(stalled)).toMatchObject({
      title: 'Возобновить работу: ДГТУ — Информационная безопасность',
      why: 'Без движения 21 дн. при пороге 14, этап 5',
      responsible: null,
    })
  })

  it('неизвестное правило — исходные заголовок и обоснование, ничего не выдумывается', () => {
    expect(summarizeRecommendation(rec({}))).toEqual({
      title: 'Полный заголовок правила',
      why: 'Обоснование правила',
      responsible: null,
    })
  })

  it('ответственный и его краткое имя', () => {
    expect(responsibleOf('Срок прошёл. Ответственный: Кириллов Пётр Андреевич.')).toBe('Кириллов Пётр Андреевич')
    expect(responsibleOf('Без ответственного.')).toBeNull()
    expect(shortPersonName('Савельева Ольга Дмитриевна')).toBe('Савельева О. Д.')
    expect(shortPersonName('Савельева')).toBe('Савельева')
  })
})

describe('значение и действие справа', () => {
  it('у просрочки — «−101 дн.» красным, у остальных значения нет', () => {
    expect(rowValue(overdue)).toEqual({ text: '−101\u00a0дн.', tone: 'danger' })
    expect(rowValue(rec({}))).toBeUndefined()
  })

  it('одно действие: принять, закрыть, вернуть; отклонение — в раскрытии', () => {
    expect(primaryTransition('NEW')).toBe('IN_PROGRESS')
    expect(primaryTransition('IN_PROGRESS')).toBe('DONE')
    expect(primaryTransition('DISMISSED')).toBe('NEW')
    expect(primaryTransition('DONE')).toBeNull()
    expect(canDismiss('NEW')).toBe(true)
    expect(canDismiss('DONE')).toBe(false)
  })
})

describe('группы ленты', () => {
  const rows = [
    rec({ id: 'a', priority: 'HIGH' }),
    rec({ id: 'b', priority: 'CRITICAL' }),
    rec({ id: 'c', priority: 'HIGH' }),
    rec({ id: 'd', priority: 'LOW' }),
  ]

  it('«сначала важное» — от критичного к низкому, пустых групп нет, порядок внутри сохранён', () => {
    expect(PRIORITY_ORDER).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])
    const groups = groupRecommendations(rows, true)
    expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
      ['Критичный приоритет', ['b']],
      ['Высокий приоритет', ['a', 'c']],
      ['Низкий приоритет', ['d']],
    ])
  })

  it('«по баллу» — одна группа в порядке сервера', () => {
    const groups = groupRecommendations(rows, false)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.items.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(groupRecommendations([], false)).toEqual([])
  })
})
