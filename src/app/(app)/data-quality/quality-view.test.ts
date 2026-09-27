import { describe, expect, it } from 'vitest'
import type { QualityIssueDto, QualityReportDto } from '@/shared/contracts'
import {
  CRITICAL_PENALTY,
  deviationText,
  entitiesWorstFirst,
  groupIssues,
  issueAction,
  issueLevel,
  pointsWord,
  qualityConclusion,
  scoreLevel,
} from './quality-view'

function issue(code: string, count: number, penalty: number): QualityIssueDto {
  return { code, title: code, count, share: count / 10, weight: 0.5, penalty, items: [] }
}

describe('уровни качества данных', () => {
  it('проверка без находок — «всё хорошо», даже с весом', () => {
    expect(issueLevel(issue('a', 0, 0))).toBe('ok')
  })

  it('критично — когда проблема отнимает у сущности от порога баллов и больше', () => {
    expect(issueLevel(issue('a', 3, CRITICAL_PENALTY))).toBe('critical')
    expect(issueLevel(issue('a', 3, CRITICAL_PENALTY - 0.1))).toBe('attention')
  })

  it('группирует по уровням и ставит тяжёлые проблемы первыми', () => {
    const report: QualityReportDto = {
      score: 80,
      entities: [
        { entity: 'skill', title: 'Навыки', total: 10, score: 90, weight: 0.5, issues: [issue('small', 1, 2), issue('none', 0, 0)] },
        { entity: 'product', title: 'IT-продукты', total: 10, score: 70, weight: 0.5, issues: [issue('big', 4, 27), issue('mid', 2, 6)] },
      ],
      duplicates: { university: 0, skill: 0, program: 0, product: 0 },
      explanation: '',
      generatedAt: '2026-09-26T00:00:00.000Z',
      isMock: true,
    }
    const groups = groupIssues(report)
    expect(groups.critical.map((item) => item.issue.code)).toEqual(['big'])
    expect(groups.attention.map((item) => item.issue.code)).toEqual(['mid', 'small'])
    expect(groups.ok.map((item) => item.issue.code)).toEqual(['none'])
  })

  it('нет оценки — нет вердикта, а не «критично»', () => {
    expect(scoreLevel(null)).toBeNull()
    expect(scoreLevel(92.4)).toBe('ok')
    expect(scoreLevel(80)).toBe('attention')
    expect(scoreLevel(60)).toBe('critical')
  })
})

function report(overrides: Partial<QualityReportDto> = {}): QualityReportDto {
  return {
    score: 92.6,
    entities: [
      { entity: 'university', title: 'Вузы', total: 17, score: 100, weight: 0.3, issues: [issue('university.noContacts', 0, 0)] },
      {
        entity: 'product',
        title: 'IT-продукты',
        total: 23,
        score: 72.6,
        weight: 0.2,
        issues: [{ ...issue('product.noSkills', 9, 27.4), title: 'IT-продукт без навыков' }, issue('product.duplicates', 0, 0)],
      },
      { entity: 'cooperation', title: 'Связки', total: 0, score: null, weight: 0.2, issues: [] },
    ],
    duplicates: { university: 0, skill: 0, program: 0, product: 0 },
    explanation: '',
    generatedAt: '2026-09-27T00:00:00.000Z',
    isMock: true,
    ...overrides,
  }
}

describe('индекс качества словами', () => {
  it('отклонение от цели — словами и с числом', () => {
    expect(deviationText(72.6)).toBe('ниже цели на 17,4')
    expect(deviationText(92.6, true)).toBe('выше цели 90 на 2,6')
    expect(deviationText(90)).toBe('ровно на цели')
    expect(deviationText(null)).toBe('нет данных')
  })

  it('справочники — от худшего к лучшему, без оценки — в конце', () => {
    expect(entitiesWorstFirst(report()).map((entity) => entity.entity)).toEqual(['product', 'university', 'cooperation'])
  })

  it('вывод называет самую тяжёлую проверку и считает проверки с замечаниями', () => {
    expect(qualityConclusion(report())).toBe(
      'Больше всего баллов отнимает «IT-продукт без навыков»: 9 из 23, −27,4 балла у справочника «IT-продукты». Замечания — у 1 из 3 проверок.',
    )
    expect(qualityConclusion(report({ score: null }))).toBe('Справочники пусты — оценивать пока нечего.')
  })

  it('склонение баллов', () => {
    expect(pointsWord(1)).toBe('балл')
    expect(pointsWord(3)).toBe('балла')
    expect(pointsWord(12)).toBe('баллов')
    expect(pointsWord(27.4)).toBe('балла')
  })
})

describe('действие по проверке', () => {
  it('дубли — разобрать пары своего справочника', () => {
    expect(issueAction(issue('skill.duplicates', 4, 6))).toEqual({ kind: 'duplicates', entity: 'skill' })
  })

  it('ссылка на запись — «Исправить», на реестр — «Открыть», без находок — ничего', () => {
    const toRecord = { ...issue('cooperation.noMeetings', 2, 5), items: [{ id: 'c1', name: 'Связка', href: '/cooperations/c1' }] }
    const toRegistry = { ...issue('product.noSkills', 2, 5), items: [{ id: 'p1', name: 'Продукт', href: '/products' }] }
    expect(issueAction(toRecord)).toEqual({ kind: 'link', href: '/cooperations/c1', label: 'Исправить' })
    expect(issueAction(toRegistry)).toEqual({ kind: 'link', href: '/products', label: 'Открыть' })
    expect(issueAction(issue('program.noSkills', 0, 0))).toBeNull()
  })
})
