/**
 * Пределы того, что PostgreSQL способен принять.
 *
 * Проверка на входе API должна знать не только смысл полей, но и типы колонок:
 * значение, которое прошло Zod и не помещается в базу, дошло бы до запроса
 * и вернулось как «Внутренняя ошибка сервера» — вместо понятного отказа с именем
 * поля. Отсюда проверки входа берут пределы базы, а не угадывают их по месту.
 */

/**
 * Наибольшее значение колонки `Int` (int4 в PostgreSQL).
 *
 * `z.number().int()` пропускает любое безопасное целое JavaScript — до 2^53,
 * и «Студентов: 99 999 999 999» прошло бы проверку, а упало на записи.
 */
export const PG_INT_MAX = 2_147_483_647

/**
 * Символ с кодом 0 PostgreSQL не принимает ни в одном текстовом значении —
 * ни при записи, ни в условии поиска: запрос падает с ошибкой 22021.
 * С клавиатуры его не набрать: он приходит из повреждённого или двоичного
 * файла, из копирования и из подобранных запросов.
 */
const NUL = '\u0000'

export function containsNul(value: string): boolean {
  return value.includes(NUL)
}

/**
 * Путь к первому значению с символом кода 0 — строке или ключу объекта —
 * в формате поля ошибки валидации (`contacts.0.fullName`). `null`, если его нет.
 */
export function findNul(value: unknown, path: ReadonlyArray<string | number> = []): string | null {
  const here = (): string => (path.length > 0 ? path.join('.') : '_')

  if (typeof value === 'string') return containsNul(value) ? here() : null

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findNul(item, [...path, index])
      if (found !== null) return found
    }
    return null
  }

  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (containsNul(key)) return here()
      const found = findNul(item, [...path, key])
      if (found !== null) return found
    }
  }

  return null
}
