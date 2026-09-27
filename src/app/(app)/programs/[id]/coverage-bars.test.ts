import { describe, expect, it } from 'vitest'
import type { SkillGapDto } from '@/shared/contracts'
import { coverageConclusion, coverageRows } from './coverage-bars'

function gap(name: string, demand: number | null, coverage: number, extra: Partial<SkillGapDto> = {}): SkillGapDto {
  return {
    skillId: name,
    name,
    category: 'Категория',
    demand: null,
    demandNormalized: demand,
    coverage,
    level: null,
    importance: null,
    gap: demand === null ? 0 : Math.max(0, demand - coverage),
    isCritical: false,
    explanation: '',
    outOfProfile: false,
    isMock: true,
    ...extra,
  }
}

describe('«Спрос против покрытия» полосами вместо радара (решение 215)', () => {
  const rows = [
    gap('SQL', 1, 1),
    gap('Kubernetes', 0.85, 0, { isCritical: true }),
    gap('JavaScript', 0.73, 0.67),
    gap('Java', 0.9, 0, { outOfProfile: true }),
  ]

  it('полоса — покрытие, отметка — спрос, дефицит словами; вне профиля не выносится', () => {
    const bars = coverageRows(rows)
    expect(bars.map((row) => row.label)).toEqual(['SQL', 'Kubernetes', 'JavaScript'])
    expect(bars[0]).toMatchObject({ value: 100, marker: 100, tone: 'default', note: 'спрос 100 — покрыт' })
    expect(bars[1]).toMatchObject({ value: 0, marker: 85, tone: 'danger', note: 'спрос 85 — в программе нет' })
    expect(bars[2]).toMatchObject({ value: 67, marker: 73, tone: 'warning', note: 'спрос 73 — не хватает 6' })
  })

  it('вывод одной фразой — «из N» показанных', () => {
    expect(coverageConclusion(rows)).toBe(
      'Рынок просит больше, чем даёт программа, по 2 из 3 навыков: «Kubernetes» и «JavaScript».',
    )
    expect(coverageConclusion([gap('SQL', 0.5, 1)])).toBe('Программа покрывает спрос рынка по всем показанным навыкам.')
  })
})
