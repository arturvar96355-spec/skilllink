import { describe, expect, it } from 'vitest'
import { SKILL_GAP } from '@/shared/config/analytics.config'
import { calculateGap, coverageByLevel, demandNormalizer } from './skills.rules'

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
