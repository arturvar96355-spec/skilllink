/** Меньше этого гибкий столбец не сжимается: название в нём должно читаться. */
const FLEX_COLUMN_MIN = 180

/**
 * Наименьшая ширина таблицы: заданные столбцы плюс минимум на каждый гибкий.
 *
 * Раскладка фиксированная (см. стили): гибкие столбцы делят остаток поровну.
 * Когда заданные ширины съедали почти всю строку, гибким доставалось по сорок
 * пикселей — в реестре документов на 1280 название сжималось в столбик, а текст
 * «К чему относится» наезжал на соседний столбец. Теперь в этом случае таблица
 * прокручивается вбок, а не мнётся.
 */
export function tableMinWidth(columns: ReadonlyArray<{ width?: string }>): number {
  const total = columns.reduce((sum, column) => {
    const fixed = column.width ? Number.parseInt(column.width, 10) : Number.NaN
    return sum + (Number.isFinite(fixed) ? fixed : FLEX_COLUMN_MIN)
  }, 0)
  return Math.max(720, total)
}
