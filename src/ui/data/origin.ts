/**
 * Где пометить демонстрационные данные в списке.
 *
 * Пометка обязательна: демо никогда не выдаётся за реальные данные. Но если
 * демо — весь список, одна и та же плашка в каждой строке ничего не различает,
 * а на аналитике она ещё и раздвигала таблицу шире экрана. Поэтому: одна
 * пометка у раздела, когда в выдаче есть демо; у строки — только когда
 * в выдаче смешаны демо и настоящие записи и их надо различить.
 */
export interface MockMarks<T> {
  /** Пометить раздел целиком. */
  section: boolean
  /** Пометить эту строку. */
  row: (row: T) => boolean
}

export function mockMarks<T extends { isMock: boolean }>(rows: readonly T[]): MockMarks<T> {
  const mockCount = rows.filter((row) => row.isMock).length
  const mixed = mockCount > 0 && mockCount < rows.length
  return {
    section: mockCount > 0,
    row: (row) => mixed && row.isMock,
  }
}
