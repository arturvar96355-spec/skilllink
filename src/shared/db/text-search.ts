/**
 * Условие «содержит» для поиска по тексту — без учёта регистра.
 *
 * Prisma передаёт строку в LIKE как есть, и `%` с `_` в ней работают как
 * подстановочные знаки: поиск «_» находил все 111 вузов, «%» — тоже, а запрос
 * «скидка 10%» искал бы «скидка 10» с чем угодно после. Экранируем их обратной
 * косой чертой — это экранирующий символ LIKE в PostgreSQL по умолчанию.
 */
export function textContains(query: string): { contains: string; mode: 'insensitive' } {
  return { contains: escapeLike(query), mode: 'insensitive' }
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}
