import { describe, expect, it } from 'vitest'
import { tableMinWidth } from './table-width'

describe('ширина таблицы реестра', () => {
  it('гибким столбцам — не меньше 180 пикселей каждому', () => {
    // Реестр документов: шесть заданных столбцов на 890 пикселей и два гибких.
    // На 1280 с меню гибким доставалось по ~50 — название сжималось в столбик.
    expect(
      tableMinWidth([{}, { width: '90px' }, { width: '160px' }, {}, { width: '160px' }, { width: '160px' }, { width: '170px' }, { width: '150px' }]),
    ).toBe(890 + 360)
  })

  it('не меньше прежнего минимума', () => {
    expect(tableMinWidth([{}, {}])).toBe(720)
  })
})
