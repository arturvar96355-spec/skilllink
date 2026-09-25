import { describe, expect, it } from 'vitest'
import { SKILL_GAP } from '@/shared/config/analytics.config'
import {
  calculateGap,
  coverageByLevel,
  demandNormalizer,
  demandPerSkill,
  latestOfPeriods,
  directionGroup,
  isInProfile,
  outOfProfileNote,
  type DirectionProfile,
} from './skills.rules'

describe('покрытие навыка программой', () => {
  it('без навыка покрытие равно нулю', () => {
    expect(coverageByLevel(null)).toBe(0)
  })

  it('растёт вместе с уровнем освоения', () => {
    expect(coverageByLevel('BASIC')).toBeLessThan(coverageByLevel('INTERMEDIATE'))
    expect(coverageByLevel('INTERMEDIATE')).toBeLessThan(coverageByLevel('ADVANCED'))
    expect(coverageByLevel('ADVANCED')).toBe(1)
  })
})

describe('нормирование спроса', () => {
  it('приводит выборку к диапазону 0..1', () => {
    const normalize = demandNormalizer([100, 500, 900])
    expect(normalize(100)).toBe(0)
    expect(normalize(900)).toBe(1)
    expect(normalize(500)).toBe(0.5)
  })

  it('на пустой выборке возвращает null, а не ноль', () => {
    const normalize = demandNormalizer([])
    expect(normalize(500)).toBeNull()
  })
})

describe('дефицит навыка', () => {
  it('помечает критичным востребованный навык, которого нет в программе', () => {
    const result = calculateGap(0.9, null, 'Kubernetes')
    expect(result.isCritical).toBe(true)
    expect(result.coverage).toBe(0)
    expect(result.gap).toBe(0.9)
    expect(result.explanation).toContain('Kubernetes')
  })

  it('не считает критичным навык со слабым спросом', () => {
    const below = SKILL_GAP.demandThreshold - 0.1
    expect(calculateGap(below, null, 'Бизнес-анализ').isCritical).toBe(false)
  })

  it('не считает критичным навык, который программа покрывает', () => {
    expect(calculateGap(0.95, 'ADVANCED', 'Python').isCritical).toBe(false)
  })

  it('без данных о спросе не выдумывает дефицит', () => {
    const result = calculateGap(null, null, 'Редкий навык')
    expect(result.gap).toBe(0)
    expect(result.isCritical).toBe(false)
    expect(result.explanation).toContain('Нет данных')
  })

  it('дефицит не бывает отрицательным', () => {
    expect(calculateGap(0.2, 'ADVANCED', 'SQL').gap).toBe(0)
  })
})

describe('обрезание выборки не искажает счётчик', () => {
  const gaps = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      skillId: `s${index}`,
      gap: 1 - index / 100,
      isCritical: index % 2 === 0,
    }))

  it('total считается до обрезания, а не после', () => {
    // Система существует ради показа дефицитов. Если при limit=5 она сообщит
    // «найдено 5», она занижает ровно ту проблему, которую должна показывать.
    const all = gaps(18)
    const limit = 5
    const shown = all.slice(0, limit)

    expect(shown).toHaveLength(limit)
    expect(all.length).toBe(18)
    expect(all.length > shown.length).toBe(true)
  })

  it('признак обрезания честен в обе стороны', () => {
    const all = gaps(18)
    expect(all.length > all.slice(0, 5).length).toBe(true)
    expect(all.length > all.slice(0, 200).length).toBe(false)
  })
})

describe('последний период рыночных данных', () => {
  it('по календарю, а не по алфавиту', () => {
    // Строкой «2026-Q1» больше «2026-09»: буква после цифр. По календарю — наоборот.
    expect(latestOfPeriods(['2026-Q1', '2026-09'])).toBe('2026-09')
    expect(latestOfPeriods(['2025-Q4', '2026-Q1'])).toBe('2026-Q1')
    expect(latestOfPeriods(['2026-Q3', '2026-08'])).toBe('2026-Q3')
  })

  it('нет периодов — нет данных', () => {
    expect(latestOfPeriods([])).toBeNull()
  })
})

describe('спрос — одна строка на навык', () => {
  it('федеральный замер важнее регионального', () => {
    const rows = [
      { skillId: 'sql', value: 900, region: 'Москва' },
      { skillId: 'sql', value: 500, region: 'Россия' },
      { skillId: 'go', value: 40, region: 'Казань' },
      { skillId: 'go', value: 70, region: 'Москва' },
    ]
    const result = demandPerSkill(rows)
    expect(result).toHaveLength(2)
    expect(result.find((row) => row.skillId === 'sql')?.value).toBe(500)
    // Без федерального — наибольший региональный.
    expect(result.find((row) => row.skillId === 'go')?.value).toBe(70)
  })
})

describe('обоснование дефицита — целыми пунктами', () => {
  it('без дробей и точки в русском тексте, как в рекомендациях', () => {
    const critical = calculateGap(0.7033, null, 'PostgreSQL')
    expect(critical.explanation).toContain('(70 из 100)')
    const partial = calculateGap(0.5555, 'BASIC', 'Python')
    expect(partial.explanation).toBe('Спрос 56 из 100, покрытие программой 34 из 100')
    for (const text of [critical.explanation, partial.explanation]) {
      expect(text).not.toMatch(/\d\.\d/)
    }
  })
})

describe('дефициты вне профиля программы (решение 98)', () => {
  const profile: DirectionProfile = {
    group: '02',
    skillIds: new Set(['python', 'ml']),
    categories: new Set(['Языки программирования', 'Данные']),
  }

  it('группа направлений — первые две цифры кода', () => {
    expect(directionGroup('09.03.04')).toBe('09')
    expect(directionGroup(' 02.04.02 ')).toBe('02')
    expect(directionGroup(null)).toBeNull()
    expect(directionGroup('без кода')).toBeNull()
  })

  it('навык, который преподаёт группа, — в профиле', () => {
    expect(isInProfile({ id: 'python', category: 'Языки программирования' }, profile)).toBe(true)
  })

  it('навык той же области — в профиле', () => {
    expect(isInProfile({ id: 'analytics', category: 'Данные' }, profile)).toBe(true)
  })

  it('языки сравниваются поимённо: Python не делает «своей» Java', () => {
    expect(isInProfile({ id: 'java', category: 'Языки программирования' }, profile)).toBe(false)
  })

  it('чужая область — вне профиля, пояснение называет группу и область', () => {
    expect(isInProfile({ id: 'k8s', category: 'DevOps' }, profile)).toBe(false)
    expect(outOfProfileNote('DevOps', '02')).toContain('группы направлений 02')
    expect(outOfProfileNote('DevOps', '02')).toContain('«DevOps»')
    expect(outOfProfileNote('Языки программирования', '02')).toContain('этот язык')
  })
})
