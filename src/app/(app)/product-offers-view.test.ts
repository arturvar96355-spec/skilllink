import { describe, expect, it } from 'vitest'
import type { ProductRecommendationDto } from '@/shared/contracts'
import { cooperationGoal, offerRow, reachMax, reachRows, splitCommonReasons } from './product-offers-view'

const ITEM: ProductRecommendationDto = {
  program: { id: 'p1', name: 'Программная инженерия', universityId: 'u1', universityName: 'СПбГУТ' },
  product: { id: 'cloud', name: 'Облачная платформа РТК', category: 'Инфраструктура' },
  score: 55,
  baseScore: 55,
  adjustments: [],
  closes: [
    { skillId: 'k8s', name: 'Kubernetes', demand: 85, coverage: 0, level: null, gap: 85, relevance: 'RELATED', outOfProfile: false, demandValue: 9400, demandUnit: 'вакансий' },
    { skillId: 'kotlin', name: 'Kotlin', demand: 40, coverage: 0, level: null, gap: 40, relevance: 'OPTIONAL', outOfProfile: true, demandValue: 3000, demandUnit: 'вакансий' },
  ],
  productSkillCount: 4,
  productSkillsWithDemand: 4,
  reasons: [],
  confidence: 'HIGH',
  confidenceNote: '',
  lowData: false,
}

describe('рекомендации продуктов на экране', () => {
  it('полоса балла: число подписано, уверенность словами, программа — в карточке вуза', () => {
    expect(offerRow(ITEM)).toMatchObject({ label: 'Облачная платформа РТК', value: 55, valueText: '55 из 100', note: 'уверенность высокая', tone: 'default' })
    expect(offerRow(ITEM).caption).toBeUndefined()
    expect(offerRow(ITEM, { withProgram: true }).caption).toBe('Программная инженерия · СПбГУТ')
  })

  it('мало данных — полоса приглушена, подпись предупреждает', () => {
    const row = offerRow({ ...ITEM, confidence: 'LOW', lowData: true })
    expect(row).toMatchObject({ tone: 'muted', note: 'мало данных', noteTone: 'warning' })
  })

  it('«куда нести»: продукты, которые никому не рекомендуются, не показываются', () => {
    const rows = reachRows([
      { productId: 'a', productName: 'СУБД', bestFor: 50, recommendedFor: 71, averageScore: 68 },
      { productId: 'b', productName: 'Киберполигон', bestFor: 0, recommendedFor: 60, averageScore: 23 },
      { productId: 'c', productName: 'Стенд', bestFor: 0, recommendedFor: 0, averageScore: null },
    ])
    expect(rows.map((row) => [row.label, row.valueText, row.note])).toEqual([
      ['СУБД', 'лучший для 50', 'рекомендуется 71 · средний балл 68'],
      ['Киберполигон', 'нигде не первый', 'рекомендуется 60 · средний балл 23'],
    ])
    expect(reachMax([])).toBe(1)
  })

  it('цель связки называет дефициты в профиле', () => {
    expect(cooperationGoal(ITEM)).toBe('Закрыть дефициты программы: Kubernetes (рекомендация продуктов, балл 55)')
  })

  it('общая для всех причина — одной строкой над списком', () => {
    const a = { ...ITEM, reasons: ['Закроет Kubernetes', 'У вуза уже идёт связка'] }
    const b = { ...ITEM, product: { ...ITEM.product, id: 'db' }, reasons: ['Закроет SQL', 'У вуза уже идёт связка'] }
    const split = splitCommonReasons([a, b])
    expect(split.common).toEqual(['У вуза уже идёт связка'])
    expect(split.own(b)).toEqual(['Закроет SQL'])
    expect(splitCommonReasons([a]).common).toEqual([])
  })
})
