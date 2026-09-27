import { describe, expect, it } from 'vitest'
import type { RecommendationDto } from '@/shared/contracts'
import { actionsSummary, expandedActionId, groupActions, openLabelOf, summarizeAction } from './priority-queue'

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
    target: { objectType: 'Cooperation', objectId: 'c1', label: 'СФУ — Сети и системы связи' },
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

describe('«Приоритетные действия»: короткий заголовок и «почему»', () => {
  it('дефицит навыка — глагол и спрос из данных правила', () => {
    const summary = summarizeAction(
      rec({
        ruleKey: 'skill.critical-gap-with-product',
        target: { objectType: 'Skill', objectId: 's1', label: 'Навык «Kubernetes»' },
        relatedData: { demandNormalized: 0.852, programCount: 75 },
      }),
    )
    expect(summary).toEqual({ title: 'Предложить Kubernetes вузам', why: 'Спрос 85 из 100, нет в 75 программах' })
  })

  it('связка без продукта — этап из данных', () => {
    expect(
      summarizeAction(rec({ ruleKey: 'cooperation.no-product', relatedData: { currentStageNumber: 9 } })),
    ).toEqual({ title: 'Выбрать продукт: СФУ — Сети и системы связи', why: 'Этап 9 из 14, продукт не выбран' })
  })

  it('связка без движения — дни и порог', () => {
    expect(
      summarizeAction(
        rec({ ruleKey: 'cooperation.stalled', relatedData: { idleDays: 21, thresholdDays: 14, stageNumber: 5 } }),
      ).why,
    ).toBe('Без движения 21 дн. при пороге 14, этап 5')
  })

  it('нет данных по программе — сколько показателей не заполнено', () => {
    expect(
      summarizeAction(
        rec({
          ruleKey: 'program.missing-metrics',
          target: { objectType: 'EducationalProgram', objectId: 'p1', label: 'Прикладная информатика · НГТУ' },
          relatedData: { missing: ['studentCount', 'groupCount'] },
        }),
      ),
    ).toEqual({ title: 'Запросить показатели: НГТУ — Прикладная информатика', why: 'Не заполнено 2 из 3 показателей набора' })
  })

  it('неизвестное правило или нет данных — исходные заголовок и обоснование, ничего не выдумано', () => {
    expect(summarizeAction(rec({}))).toEqual({ title: 'Полный заголовок правила', why: 'Обоснование правила' })
    expect(summarizeAction(rec({ ruleKey: 'cooperation.no-product' })).why).toBe('Обоснование правила')
  })

  it('действие «Открыть …» — по виду объекта', () => {
    expect(openLabelOf({ objectType: 'Cooperation', objectId: 'x', label: '' })).toBe('Открыть связку')
    expect(openLabelOf({ objectType: 'Skill', objectId: 'x', label: '' })).toBe('Открыть навык')
  })
})

describe('«Приоритетные действия»: группы и описание', () => {
  const five = [
    rec({ id: 'a', status: 'NEW', score: 0.63 }),
    rec({ id: 'b', status: 'IN_PROGRESS', score: 0.62 }),
    rec({ id: 'c', status: 'NEW', score: 0.6 }),
    rec({ id: 'd', status: 'NEW', score: 0.5 }),
    rec({ id: 'e', status: 'IN_PROGRESS', score: 0.48 }),
  ]

  it('«Новые» и «В работе», порядок внутри — как с сервера (по баллу)', () => {
    expect(groupActions(five).map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
      ['Новые', ['a', 'c', 'd']],
      ['В работе', ['b', 'e']],
    ])
  })

  it('пустая группа не рисуется', () => {
    expect(groupActions(five.filter((item) => item.status === 'NEW')).map((group) => group.key)).toEqual(['NEW'])
  })

  it('приоритет в описании — один раз, если одинаковый у всех', () => {
    expect(actionsSummary(five)).toBe('5 дел высокого приоритета: новых 3, в работе 2.')
    expect(actionsSummary([...five, rec({ id: 'f', priority: 'MEDIUM' })])).toBe('6 дел: новых 4, в работе 2.')
  })
})

describe('«Приоритетные действия»: раскрытая строка', () => {
  const rows = [{ id: 'a' }, { id: 'b' }]

  it('пока пользователь ничего не выбирал — раскрыта первая', () => {
    expect(expandedActionId(rows, undefined)).toBe('a')
  })

  it('выбор пользователя главнее; «свернуть всё» — ничего не раскрыто', () => {
    expect(expandedActionId(rows, 'b')).toBe('b')
    expect(expandedActionId(rows, null)).toBeNull()
  })

  it('выбранной строки больше нет — ничего не раскрыто; пустой список — тоже', () => {
    expect(expandedActionId(rows, 'z')).toBeNull()
    expect(expandedActionId([], undefined)).toBeNull()
  })
})
