import { describe, expect, it } from 'vitest'
import type { QualityIssueDto, QualityReportDto } from '@/shared/contracts'
import { CRITICAL_PENALTY, groupIssues, issueLevel, scoreLevel } from './quality-view'

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
