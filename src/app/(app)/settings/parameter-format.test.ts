import { describe, expect, it } from 'vitest'
import type { CalculationParameterDto } from '@/shared/contracts'
import { formatParameterValue } from './parameter-format'

function param(patch: Partial<CalculationParameterDto>): CalculationParameterDto {
  return {
    configKey: 'TEST.key',
    label: 'Тестовый параметр',
    hint: null,
    value: 0,
    unit: 'count',
    valueLabel: null,
    isTemporary: false,
    ...patch,
  }
}

describe('formatParameterValue', () => {
  it('weight — десятичное число, а не проценты', () => {
    expect(formatParameterValue(param({ unit: 'weight', value: 0.4 }))).toBe('0,4')
  })

  it('share — целый процент', () => {
    expect(formatParameterValue(param({ unit: 'share', value: 0.77 }))).toBe('77%')
  })

  it('days и minutes — число с подписью единицы', () => {
    expect(formatParameterValue(param({ unit: 'days', value: 14 }))).toBe('14 дн.')
    expect(formatParameterValue(param({ unit: 'minutes', value: 30 }))).toBe('30 мин.')
  })

  it('stage — «этап N»', () => {
    expect(formatParameterValue(param({ unit: 'stage', value: 7 }))).toBe('этап 7')
  })

  it('flag — да/нет словами, а не true/false', () => {
    expect(formatParameterValue(param({ unit: 'flag', value: true }))).toBe('Да')
    expect(formatParameterValue(param({ unit: 'flag', value: false }))).toBe('Нет')
  })

  it('choice — подпись из valueLabel', () => {
    expect(
      formatParameterValue(param({ unit: 'choice', value: 'AVERAGE', valueLabel: 'среднее по программам' })),
    ).toBe('среднее по программам')
  })

  it('list — перечень через запятую', () => {
    expect(formatParameterValue(param({ unit: 'list', value: [1, 2, 3] }))).toBe('1, 2, 3')
  })

  it('count — целое число с подписью, если единица не задана', () => {
    expect(formatParameterValue(param({ unit: 'count', value: 5 }))).toBe('5')
  })
})
