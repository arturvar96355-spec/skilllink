import { describe, expect, it } from 'vitest'
import { PROGRAM_RATING_WEIGHTS } from '@/shared/config/analytics.config'
import { aggregateUniversityRatings, calculateRatings, type RatingInput } from './rating'

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

describe('рейтинг вуза', () => {
  const programs = [
    { programId: 'p1', applicationCount: 100, studentCount: 100, groupCount: 10, metricsSource: 'MANUAL' as const },
    { programId: 'p2', applicationCount: 50, studentCount: 50, groupCount: 5, metricsSource: 'MANUAL' as const },
    { programId: 'p3', applicationCount: 0, studentCount: 0, groupCount: 0, metricsSource: 'MANUAL' as const },
    { programId: 'p4', applicationCount: null, studentCount: null, groupCount: null, metricsSource: null },
  ]
  const links = [
    { programId: 'p1', programName: 'Сильная', universityId: 'u1' },
    { programId: 'p3', programName: 'Слабая', universityId: 'u1' },
    { programId: 'p2', programName: 'Средняя', universityId: 'u2' },
    { programId: 'p4', programName: 'Без данных', universityId: 'u3' },
  ]

  function aggregate() {
    return aggregateUniversityRatings(links, calculateRatings(programs))
  }

  it('считает балл вуза по его программам', () => {
    const rating = aggregate().get('u1')
    expect(rating?.score).not.toBeNull()
    expect(rating?.programCount).toBe(2)
    expect(rating?.ratedProgramCount).toBe(2)
  })

  it('раскрывает сильнейшую программу — балл должен быть объяснимым', () => {
    expect(aggregate().get('u1')?.topProgram?.name).toBe('Сильная')
  })

  it('вуз без заполненных показателей получает «Нет данных», а не ноль', () => {
    const rating = aggregate().get('u3')
    expect(rating?.score).toBeNull()
    expect(rating?.basis).toBe('none')
    expect(rating?.explanation).toContain('Нет данных')
  })

  it('программа без данных не тянет средний балл вниз', () => {
    // u2 — одна средняя программа. Если бы «нет данных» считалось нулём,
    // вуз с такой же средней программой плюс пустой получил бы вдвое меньше.
    const withEmpty = aggregateUniversityRatings(
      [...links, { programId: 'p4', programName: 'Без данных', universityId: 'u2' }],
      calculateRatings(programs),
    )
    expect(withEmpty.get('u2')?.score).toBe(aggregate().get('u2')?.score)
    expect(withEmpty.get('u2')?.ratedProgramCount).toBe(1)
    expect(withEmpty.get('u2')?.programCount).toBe(2)
  })

  it('оценочные данные хотя бы одной программы делают весь балл оценочным', () => {
    const rating = aggregateUniversityRatings(
      [{ programId: 'p1', programName: 'Сильная', universityId: 'u1' }],
      calculateRatings([{ ...programs[0]!, metricsSource: 'MOCK' as const }, programs[1]!]),
    ).get('u1')
    expect(rating?.basis).toBe('estimate')
  })

  it('вуз без программ в карту не попадает — подставлять ноль нечем', () => {
    expect(aggregate().has('u-без-программ')).toBe(false)
  })

  it('балл вуза не выходит за шкалу 0..100', () => {
    for (const rating of aggregate().values()) {
      if (rating.score === null) continue
      expect(rating.score).toBeGreaterThanOrEqual(0)
      expect(rating.score).toBeLessThanOrEqual(100)
    }
  })
})
