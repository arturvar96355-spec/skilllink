import { describe, expect, it } from 'vitest'
import { showAllState } from './show-all'

describe('«Показать все» у обрезанного списка', () => {
  it('всё уже на экране — ни подписи, ни кнопки', () => {
    expect(showAllState(12, 12, 20, 100)).toBeNull()
  })

  it('записей не больше максимума — «Показать все»', () => {
    expect(showAllState(20, 45, 20, 100)).toEqual({ note: 'Показаны 20 из 45.', action: 'Показать все' })
  })

  it('записей больше максимума — кнопка честно называет предел', () => {
    expect(showAllState(20, 340, 20, 100)).toEqual({ note: 'Показаны 20 из 340.', action: 'Показать первые 100' })
  })

  it('предел уже максимальный — подпись «первые N из M» и никакой мёртвой кнопки', () => {
    expect(showAllState(100, 340, 100, 100)).toEqual({ note: 'Показаны первые 100 из 340.', action: null })
  })
})
