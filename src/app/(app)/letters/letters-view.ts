import {
  AI_FALLBACK_REASON_LABELS,
  INBOUND_LETTER_GROUP_LABELS,
  type InboundLetterAnalysisDto,
  type InboundLetterGroupStatsDto,
} from '@/shared/contracts'
import { formatShare, NO_DATA } from '@/ui/lib/format'

/**
 * Чистая логика экранов «Письма вузов» (решение 170/171): без React, чтобы
 * форматирование уверенности, подсветку цитат и сборку фильтров списка можно
 * было проверить тестом, а не глазами на странице.
 */

/** Фильтры реестра писем — форма экрана, из которой строится запрос к API. */
export interface LettersFilters {
  status: string
  group: string
  universityId: string
  cooperationId: string
  sort: string
  page: number
  pageSize: number
}

/**
 * Параметры запроса `GET /api/inbound-letters` из состояния фильтров реестра.
 *
 * Отдельная функция от `buildQuery` (`@/ui`): та лишь сериализует уже готовый
 * набор параметров в строку, а здесь — какие параметры вообще нужны при какой
 * форме фильтра (пустая строка — фильтр снят, а не значение "").
 */
export function buildLettersFilterQuery(filters: LettersFilters): Record<string, string | number | undefined> {
  return {
    status: filters.status || undefined,
    group: filters.group || undefined,
    universityId: filters.universityId || undefined,
    cooperationId: filters.cooperationId || undefined,
    sort: filters.sort,
    page: filters.page,
    pageSize: filters.pageSize,
  }
}

/** Уверенность разбора (0..1) — целым процентом; `null` — письмо ещё не разобрано. */
export function formatLetterConfidence(confidence: number | null): string {
  if (confidence === null) return NO_DATA
  return formatShare(confidence)
}

/**
 * Честная подпись, кем разобрано письмо (по образцу `aiDraftSourceNote` ИИ-помощника,
 * решение 90): «Разобрано моделью» или «Разобрано правилами» — и если правилами
 * потому, что модель недоступна, — почему именно, без замалчивания.
 */
export function analyzedByNote(
  analysis: Pick<InboundLetterAnalysisDto, 'analyzedBy' | 'fallbackReason'>,
): string {
  if (analysis.analyzedBy === null) return 'Ещё не разобрано'
  if (analysis.analyzedBy === 'MODEL') return 'Разобрано моделью'
  const reason = analysis.fallbackReason ? AI_FALLBACK_REASON_LABELS[analysis.fallbackReason] : null
  return reason ? `Разобрано правилами — модель недоступна: ${reason}` : 'Разобрано правилами'
}

/** Сегмент текста письма для показа: обычный или цитата-основание (подсветка). */
export interface LetterTextSegment {
  text: string
  isQuote: boolean
}

/**
 * Разбивает текст письма на сегменты для подсветки цитат-оснований разбора.
 *
 * Поиск без учёта регистра, по точному вхождению; пустые и не найденные
 * цитаты пропускаются, совпадения не пересекаются (более раннее по позиции
 * в тексте побеждает более позднее, если они перекрылись).
 */
export function highlightQuotes(text: string, quotes: readonly string[]): LetterTextSegment[] {
  if (text === '') return []

  const lowerText = text.toLowerCase()
  const ranges: Array<{ start: number; end: number }> = []

  for (const quote of quotes) {
    const needle = quote.trim().toLowerCase()
    if (needle === '') continue
    let from = 0
    while (from <= lowerText.length) {
      const index = lowerText.indexOf(needle, from)
      if (index === -1) break
      ranges.push({ start: index, end: index + needle.length })
      from = index + needle.length
    }
  }

  if (ranges.length === 0) return [{ text, isQuote: false }]

  // Сортируем по началу; при пересечении оставляем то, что нашлось раньше в списке
  // цитат (стабильная сортировка), — оно и было основанием разбора.
  ranges.sort((a, b) => a.start - b.start || b.end - a.end)

  const merged: Array<{ start: number; end: number }> = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range.start < last.end) {
      // Перекрытие — расширяем предыдущий диапазон, а не создаём отдельную подсветку.
      last.end = Math.max(last.end, range.end)
      continue
    }
    merged.push({ ...range })
  }

  const segments: LetterTextSegment[] = []
  let cursor = 0
  for (const range of merged) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), isQuote: false })
    segments.push({ text: text.slice(range.start, range.end), isQuote: true })
    cursor = range.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), isQuote: false })

  return segments
}

/**
 * Строка полосы точности по одной группе обращения (решение 170/171):
 * «Сдвиг этапа — верно 9 из 10» — счётчики за всё время, без забывания
 * (те же, что в `GET /api/inbound-letters/stats`, поле `totalReviewed`/
 * `totalCorrect`); доля с забыванием (`accuracy`) — отдельно, в подсказке.
 */
export function letterGroupStatsText(stat: InboundLetterGroupStatsDto): string {
  const label = INBOUND_LETTER_GROUP_LABELS[stat.group]
  if (stat.totalReviewed === 0) return `${label} — ещё нет проверенных писем`
  return `${label} — верно ${stat.totalCorrect} из ${stat.totalReviewed}`
}

/** Подсказка к полосе: точность с учётом давности решений (полупериод 30 дней). */
export function letterGroupStatsHint(stat: InboundLetterGroupStatsDto): string {
  if (stat.accuracy === null) return 'Наблюдений ещё не было'
  return `Точность с учётом давности решений (половина веса теряется за 30 дней): ${formatShare(stat.accuracy)}`
}
