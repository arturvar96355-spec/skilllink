import { describe, expect, it } from 'vitest'
import { PROGRAM_RATING_WEIGHTS } from '@/shared/config/analytics.config'
import { calculateRatings, type RatingInput } from './rating'

const program = (overrides: Partial<RatingInput> & { programId: string }): RatingInput => ({
  applicationCount: null,
  studentCount: null,
  groupCount: null,
  metricsSource: 'MANUAL',
  ...overrides,
})

describe('рейтинг программ', () => {
  it('использует ровно три показателя из ТЗ', () => {
    expect(Object.keys(PROGRAM_RATING_WEIGHTS).sort()).toEqual([
      'applicationCount',
      'groupCount',
      'studentCount',
    ])
  })

  it('ставит программе с максимумом по всем показателям балл 100', () => {
    const ratings = calculateRatings([
      program({ programId: 'a', applicationCount: 400, studentCount: 200, groupCount: 8 }),
      program({ programId: 'b', applicationCount: 100, studentCount: 50, groupCount: 2 }),
    ])
    expect(ratings.get('a')?.score).toBe(100)
    expect(ratings.get('b')?.score).toBe(0)
  })

  it('возвращает null и basis none, когда нет ни одного показателя', () => {
    const ratings = calculateRatings([program({ programId: 'empty' })])
    const rating = ratings.get('empty')
    expect(rating?.score).toBeNull()
    expect(rating?.basis).toBe('none')
    expect(rating?.explanation).toContain('Нет данных')
  })

  it('не подменяет отсутствующий показатель нулём, а считает по заполненным', () => {
    const ratings = calculateRatings([
      program({ programId: 'partial', applicationCount: 300, studentCount: null, groupCount: null }),
      program({ programId: 'other', applicationCount: 100, studentCount: 10, groupCount: 1 }),
    ])
    const partial = ratings.get('partial')
    expect(partial?.score).toBe(100)
    expect(partial?.factors.find((factor) => factor.key === 'studentCount')?.value).toBeNull()
    expect(partial?.factors.find((factor) => factor.key === 'studentCount')?.contribution).toBeNull()
  })

  it('помечает демонстрационные и экспертные данные как оценочные', () => {
    const ratings = calculateRatings([
      program({ programId: 'mock', applicationCount: 100, metricsSource: 'MOCK' }),
      program({ programId: 'real', applicationCount: 200, metricsSource: 'INTEGRATION' }),
    ])
    expect(ratings.get('mock')?.basis).toBe('estimate')
    expect(ratings.get('real')?.basis).toBe('actual')
  })

  it('раскрывает вклад каждого показателя', () => {
    const ratings = calculateRatings([
      program({ programId: 'a', applicationCount: 400, studentCount: 200, groupCount: 8 }),
      program({ programId: 'b', applicationCount: 0, studentCount: 0, groupCount: 0 }),
    ])
    const factors = ratings.get('a')?.factors ?? []
    expect(factors).toHaveLength(3)
    const sum = factors.reduce((total, factor) => total + (factor.contribution ?? 0), 0)
    expect(Math.round(sum)).toBe(100)
  })

  it('выдерживает выборку из одной программы', () => {
    const ratings = calculateRatings([
      program({ programId: 'single', applicationCount: 250, studentCount: 90, groupCount: 3 }),
    ])
    expect(ratings.get('single')?.score).toBe(100)
  })
})
