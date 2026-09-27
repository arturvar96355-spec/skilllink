/**
 * Поиск по документации (решение 214) — чистые функции: страница читает текст
 * разделов из уже отрисованной разметки, а здесь только сравнение и отрывок.
 *
 * Регистр и «ё» не важны: «Срок», «СРОК» и «срок» — одно, «её» находит «ее».
 * Нормализация не меняет длину строки (одна буква на одну), поэтому позиции
 * совпадений в нормализованном тексте совпадают с позициями в исходном —
 * по ним ставится подсветка.
 */

export interface DocsIndexEntry {
  id: string
  title: string
  /** Название группы — «Письма и ИИ» находит все разделы группы. */
  group: string
  /** Весь текст раздела, как его видит человек. */
  text: string
}

export interface DocsSearchHit {
  id: string
  title: string
  group: string
  /** Отрывок вокруг первого совпадения в тексте раздела; части для подсветки. */
  snippet: SnippetPart[]
  /** Совпало в заголовке — такие выше. */
  inTitle: boolean
}

export interface SnippetPart {
  text: string
  match: boolean
}

/** Короче этого запрос не ищется: одна буква совпадает везде. */
export const MIN_QUERY_LENGTH = 2

/** Сколько знаков показывать по обе стороны от совпадения. */
const SNIPPET_SIDE = 48

/** Запросы для подсказки, когда ничего не нашлось, — заведомо находимые. */
export const DOCS_SEARCH_SUGGESTIONS = ['срок', 'этап', 'письмо', 'роль', 'Telegram', '152'] as const

export function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е')
}

/** Слова запроса без повторов; слишком короткие слова отбрасываются, если есть длинные. */
export function queryTerms(query: string): string[] {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  const long = words.filter((word) => word.length >= MIN_QUERY_LENGTH)
  return [...new Set(long.length > 0 ? long : words)]
}

export function isSearchable(query: string): boolean {
  return normalize(query).replace(/\s+/g, '').length >= MIN_QUERY_LENGTH
}

/** Все вхождения слов запроса в строке: [начало, конец), без наложений, по порядку. */
export function findRanges(text: string, terms: readonly string[]): Array<[number, number]> {
  const haystack = normalize(text)
  const ranges: Array<[number, number]> = []
  for (const term of terms) {
    if (!term) continue
    let from = 0
    for (;;) {
      const at = haystack.indexOf(term, from)
      if (at === -1) break
      ranges.push([at, at + term.length])
      from = at + term.length
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1])
  const merged: Array<[number, number]> = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }
  return merged
}

/** Отрывок вокруг первого совпадения — по границам слов, с многоточиями. */
export function snippetOf(text: string, terms: readonly string[]): SnippetPart[] {
  const flat = text.replace(/\s+/g, ' ').trim()
  const ranges = findRanges(flat, terms)
  const first = ranges[0]
  if (!first) return [{ text: flat.slice(0, SNIPPET_SIDE * 2).trimEnd() + (flat.length > SNIPPET_SIDE * 2 ? '…' : ''), match: false }]

  let start = Math.max(0, first[0] - SNIPPET_SIDE)
  let end = Math.min(flat.length, first[1] + SNIPPET_SIDE)
  if (start > 0) {
    const space = flat.indexOf(' ', start)
    start = space !== -1 && space < first[0] ? space + 1 : start
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end)
    end = space > first[1] ? space : end
  }

  const parts: SnippetPart[] = []
  if (start > 0) parts.push({ text: '…', match: false })
  let cursor = start
  for (const [from, to] of ranges) {
    if (to <= start || from >= end) continue
    const a = Math.max(from, start)
    const b = Math.min(to, end)
    if (a > cursor) parts.push({ text: flat.slice(cursor, a), match: false })
    parts.push({ text: flat.slice(a, b), match: true })
    cursor = b
  }
  if (cursor < end) parts.push({ text: flat.slice(cursor, end), match: false })
  if (end < flat.length) parts.push({ text: '…', match: false })
  return parts
}

/**
 * Раздел найден, если в нём (заголовок, группа, текст) есть все слова запроса.
 * Сначала — совпавшие в заголовке, дальше — по порядку оглавления.
 */
export function searchDocs(index: readonly DocsIndexEntry[], query: string): DocsSearchHit[] {
  if (!isSearchable(query)) return []
  const terms = queryTerms(query)
  const hits: DocsSearchHit[] = []
  for (const entry of index) {
    const all = normalize(`${entry.title} ${entry.group} ${entry.text}`)
    if (!terms.every((term) => all.includes(term))) continue
    const title = normalize(entry.title)
    hits.push({
      id: entry.id,
      title: entry.title,
      group: entry.group,
      snippet: snippetOf(entry.text, terms),
      inTitle: terms.some((term) => title.includes(term)),
    })
  }
  return [...hits.filter((hit) => hit.inTitle), ...hits.filter((hit) => !hit.inTitle)]
}
