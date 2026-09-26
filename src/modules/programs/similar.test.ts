import { describe, expect, it } from 'vitest'
import {
  cosine,
  findSimilarPrograms,
  inverseDocumentFrequency,
  sameDirection,
  similarityScore,
  skillVector,
  type ProgramForSimilarity,
} from './similar.rules'
import { SIMILAR_PROGRAMS } from '@/shared/config/data-quality.config'

/**
 * Похожие программы (решение 134): idf, косинус, бонусы за направление и уровень,
 * симметрия и self-исключение. Настоящий запрос к базе — в пробнике.
 */

function program(
  id: string,
  overrides: Partial<ProgramForSimilarity> & { skills: ProgramForSimilarity['skills'] },
): ProgramForSimilarity {
  return {
    id,
    name: `Программа ${id}`,
    universityId: 'u1',
    universityName: 'Университет',
    level: 'BACHELOR',
    code: '09.03.04',
    direction: 'Программная инженерия',
    ...overrides,
  }
}

const skill = (skillId: string, importance: ProgramForSimilarity['skills'][number]['importance'] = 'MEDIUM') => ({
  skillId,
  skillName: skillId,
  importance,
})

describe('inverseDocumentFrequency', () => {
  it('навык, который есть у всех программ, весит меньше редкого', () => {
    const programs = [
      program('a', { skills: [skill('common'), skill('rare')] }),
      program('b', { skills: [skill('common')] }),
      program('c', { skills: [skill('common')] }),
    ]
    const idf = inverseDocumentFrequency(programs)
    expect(idf.get('rare')!).toBeGreaterThan(idf.get('common')!)
  })

  it('навык без программ в idf не появляется', () => {
    const idf = inverseDocumentFrequency([program('a', { skills: [] })])
    expect(idf.size).toBe(0)
  })
})

describe('cosine', () => {
  it('идентичные векторы — сходство 1', () => {
    const v = new Map([['a', 2], ['b', 3]])
    expect(cosine(v, v)).toBeCloseTo(1, 6)
  })

  it('без общих ключей — 0', () => {
    expect(cosine(new Map([['a', 1]]), new Map([['b', 1]]))).toBe(0)
  })

  it('пустой вектор — 0, а не NaN', () => {
    expect(cosine(new Map(), new Map([['a', 1]]))).toBe(0)
  })

  it('симметричен', () => {
    const left = new Map([['a', 1], ['b', 2]])
    const right = new Map([['a', 3], ['c', 1]])
    expect(cosine(left, right)).toBeCloseTo(cosine(right, left), 10)
  })
})

describe('sameDirection', () => {
  it('одна укрупнённая группа по коду (первые две цифры)', () => {
    const a = program('a', { code: '09.03.04', direction: null, skills: [] })
    const b = program('b', { code: '09.04.01', direction: null, skills: [] })
    expect(sameDirection(a, b)).toBe(true)
  })

  it('разные группы по коду и разные направления — не совпадает', () => {
    const a = program('a', { code: '09.03.04', direction: null, skills: [] })
    const b = program('b', { code: '38.03.01', direction: 'Менеджмент', skills: [] })
    expect(sameDirection(a, b)).toBe(false)
  })

  it('без кода — сравнивается текст направления без учёта регистра', () => {
    const a = program('a', { code: null, direction: 'Информатика', skills: [] })
    const b = program('b', { code: null, direction: 'информатика', skills: [] })
    expect(sameDirection(a, b)).toBe(true)
  })
})

describe('similarityScore', () => {
  it('без бонусов — косинус, уменьшенный на долю, отведённую бонусам', () => {
    const factor = 1 - SIMILAR_PROGRAMS.directionBonus - SIMILAR_PROGRAMS.levelBonus
    expect(similarityScore(0.5, false, false)).toBeCloseTo(0.5 * factor, 6)
    expect(similarityScore(0.5, false, false)).toBeLessThan(0.5)
  })

  it('оба бонуса добавляют фиксированные доли', () => {
    const base = similarityScore(0.5, false, false)
    expect(similarityScore(0.5, true, false)).toBeCloseTo(base + SIMILAR_PROGRAMS.directionBonus, 6)
    expect(similarityScore(0.5, true, true)).toBeCloseTo(base + SIMILAR_PROGRAMS.directionBonus + SIMILAR_PROGRAMS.levelBonus, 6)
  })
})

describe('findSimilarPrograms', () => {
  const target = program('target', { skills: [skill('js', 'HIGH'), skill('sql', 'MEDIUM'), skill('git', 'LOW')] })
  const close = program('close', { skills: [skill('js', 'HIGH'), skill('sql', 'MEDIUM'), skill('docker', 'HIGH')] })
  const distant = program('distant', { code: '38.03.01', direction: 'Менеджмент', level: 'MASTER', skills: [skill('excel', 'HIGH')] })
  const noOverlap = program('none', { skills: [skill('photoshop', 'HIGH')] })
  const all = [target, close, distant, noOverlap]

  it('сама программа исключена из результатов', () => {
    const result = findSimilarPrograms('target', all, 5)
    expect(result.items.some((item) => item.program.id === 'target')).toBe(false)
  })

  it('программа без общих навыков не попадает в результат', () => {
    const result = findSimilarPrograms('target', all, 5)
    expect(result.items.some((item) => item.program.id === 'none')).toBe(false)
  })

  it('более похожая программа — выше и с большим числом общих навыков', () => {
    const result = findSimilarPrograms('target', all, 5)
    expect(result.items[0]!.program.id).toBe('close')
    expect(result.items[0]!.sharedSkills.map((s) => s.id).sort()).toEqual(['js', 'sql'])
  })

  it('«чего не хватает» — навыки похожих программ, которых нет у целевой', () => {
    const result = findSimilarPrograms('target', all, 5)
    const ids = result.missingSummary.map((item) => item.id)
    expect(ids).toContain('docker')
    expect(ids).not.toContain('js') // это общий навык, не «недостающий»
  })

  it('несуществующий id — пустой результат, без ошибки', () => {
    const result = findSimilarPrograms('nope', all, 5)
    expect(result.items).toEqual([])
    expect(result.missingSummary).toEqual([])
  })

  it('score симметричен по величине косинуса: похожесть A→B и B→A дают тот же косинус', () => {
    const idf = inverseDocumentFrequency(all)
    const cosAB = cosine(skillVector(target, idf), skillVector(close, idf))
    const cosBA = cosine(skillVector(close, idf), skillVector(target, idf))
    expect(cosAB).toBeCloseTo(cosBA, 10)

    const fromTarget = findSimilarPrograms('target', all, 5).items.find((item) => item.program.id === 'close')!
    const fromClose = findSimilarPrograms('close', all, 5).items.find((item) => item.program.id === 'target')!
    expect(fromTarget.cosine).toBeCloseTo(fromClose.cosine, 6)
  })

  it('лимит ограничивает число результатов', () => {
    const result = findSimilarPrograms('target', all, 1)
    expect(result.items).toHaveLength(1)
  })
})
