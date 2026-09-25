/**
 * Условие «содержит» для поиска по тексту — без учёта регистра.
 *
 * Prisma передаёт строку в LIKE как есть, и `%` с `_` в ней работают как
 * подстановочные знаки: поиск «_» находил бы все записи, «%» — тоже, а запрос
 * «скидка 10%» искал бы «скидка 10» с чем угодно после. Экранируем их обратной
 * косой чертой — это экранирующий символ LIKE в PostgreSQL по умолчанию.
 */
export function textContains(query: string): { contains: string; mode: 'insensitive' } {
  return { contains: escapeLike(query), mode: 'insensitive' }
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/**
 * Больше слов в запросе не разбираем: каждое слово — отдельный набор условий
 * по всем полям, и строка из сотни слов превратилась бы в сотни подзапросов.
 */
export const MAX_SEARCH_WORDS = 6

/** Слова запроса: «спбгут  программная» → ['спбгут', 'программная']. */
export function searchWords(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_WORDS)
}

/**
 * Поиск по словам: каждое слово запроса найдено хотя бы в одном поле.
 *
 * Строкой целиком запрос «спбгут программная» не совпадёт ни с одним полем —
 * краткое имя вуза в одном, название программы в другом, — и человек получит
 * «Ничего не найдено» по записи, которую видит на экране. Слова связаны «И»,
 * поля — «ИЛИ»: чем больше слов, тем уже выдача, как и ждёт человек.
 */
export function everyWordInSomeField<W>(
  query: string,
  fields: (contains: ReturnType<typeof textContains>) => W[],
): Array<{ OR: W[] }> {
  return searchWords(query).map((word) => ({ OR: fields(textContains(word)) }))
}
