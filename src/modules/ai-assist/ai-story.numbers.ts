import { MASK_LABEL } from './ai-story.masking'

/**
 * «Числа считает код» (решение 138): каждое число и каждая дата в ответе модели
 * должны встречаться в фактах. Модель, написавшая «просрочен на 60 дней» при
 * «57 дней» в фактах, не исправляет формулировку — она врёт, и ответ отбрасывается.
 *
 * Что сверяется:
 * - даты «30.07.2026» и «30.07» — с датами фактов (день и месяц вместе, не по отдельности);
 * - даты словами «30 июля 2026» — так же, по дню и месяцу, год — как число;
 * - остальные числа, целые и дробные («5», «4,5», «11:00» — это 11 и 0);
 * - числительные словами от двух до десяти («три встречи», «пяти этапов»):
 *   модель любит писать словами, и «три» при двух встречах — та же ложь.
 *
 * Чего проверка не ловит: числительные больше десяти словами и слова вроде
 * «несколько», «много». Это ограничение, оно описано в docs/AI_ASSISTANT.md.
 */

const MONTHS: Record<string, number> = {
  января: 1,
  февраля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12,
}

const NUMBER_WORDS: Record<string, number> = {
  два: 2, две: 2, двух: 2, двум: 2, двумя: 2,
  три: 3, трёх: 3, трех: 3, трём: 3, трем: 3, тремя: 3,
  четыре: 4, четырёх: 4, четырех: 4, четырём: 4, четырем: 4, четырьмя: 4,
  пять: 5, пяти: 5, пятью: 5,
  шесть: 6, шести: 6, шестью: 6,
  семь: 7, семи: 7, семью: 7,
  восемь: 8, восьми: 8, восемью: 8,
  девять: 9, девяти: 9, девятью: 9,
  десять: 10, десяти: 10, десятью: 10,
}

const NOT_LETTER_BEFORE = '(?<![A-Za-zА-Яа-яЁё])'
const NOT_LETTER_AFTER = '(?![A-Za-zА-Яа-яЁё])'

const NUMERIC_DATE = /(?<![\d.])(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?(?![\d]|\.\d)/g
const ISO_DATE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g
const WORD_DATE = new RegExp(
  `(?<!\\d)(\\d{1,2})\\s+(${Object.keys(MONTHS).join('|')})${NOT_LETTER_AFTER}(?:\\s+(\\d{4})(?!\\d))?`,
  'giu',
)
const NUMBER = /\d+(?:[.,]\d+)?/g
const NUMBER_WORD = new RegExp(
  `${NOT_LETTER_BEFORE}(${Object.keys(NUMBER_WORDS).join('|')})${NOT_LETTER_AFTER}`,
  'giu',
)

export interface NumberTokens {
  /** «30.7» — день и месяц. */
  dayMonths: Set<string>
  /** «2026», «57», «4.5». */
  numbers: Set<string>
}

function normalizeNumber(raw: string): string {
  const value = Number(raw.replace(',', '.'))
  return Number.isFinite(value) ? String(value) : raw
}

function dayMonth(day: string | number, month: string | number): string {
  return `${Number(day)}.${Number(month)}`
}

/**
 * Числа и даты текста. `forFacts` — разбор фактов: у их дат день, месяц и год
 * становятся ещё и отдельными числами, чтобы «30 июля 2026» в ответе сошлось
 * с «30.07.2026» в фактах.
 */
export function numberTokens(text: string, forFacts = false): NumberTokens {
  const dayMonths = new Set<string>()
  const numbers = new Set<string>()
  // Метки обезличивания — «[КОНТАКТ_1]» — не числа.
  let rest = text.replace(new RegExp(MASK_LABEL.source, 'g'), ' ')

  rest = rest.replace(ISO_DATE, (_match, year: string, month: string, day: string) => {
    dayMonths.add(dayMonth(day, month))
    numbers.add(normalizeNumber(year))
    if (forFacts) {
      numbers.add(normalizeNumber(day))
      numbers.add(normalizeNumber(month))
    }
    return ' '
  })
  rest = rest.replace(NUMERIC_DATE, (match, day: string, month: string, year: string | undefined) => {
    const d = Number(day)
    const m = Number(month)
    // «4,5» пишется через запятую; «4.5» без года — тоже дробь, а не 4 мая.
    if (!year && !forFacts && (m < 1 || m > 12 || d < 1 || d > 31)) return match
    if (m < 1 || m > 12 || d < 1 || d > 31) return match
    dayMonths.add(dayMonth(d, m))
    if (year) numbers.add(normalizeNumber(year))
    if (forFacts) {
      numbers.add(String(d))
      numbers.add(String(m))
    }
    return ' '
  })
  rest = rest.replace(WORD_DATE, (_match, day: string, month: string, year: string | undefined) => {
    const m = MONTHS[month.toLowerCase()]!
    dayMonths.add(dayMonth(day, m))
    if (year) numbers.add(normalizeNumber(year))
    if (forFacts) numbers.add(String(Number(day)))
    return ' '
  })
  for (const match of rest.matchAll(NUMBER)) numbers.add(normalizeNumber(match[0]))
  for (const match of rest.matchAll(NUMBER_WORD)) {
    numbers.add(String(NUMBER_WORDS[match[1]!.toLowerCase()]))
  }
  return { dayMonths, numbers }
}

/**
 * Числа и даты ответа, которых нет в фактах. Пусто — ответ по фактам.
 * Результат — для журнала разработчика и экзамена: «57», «30.7».
 */
export function unknownNumbers(answer: string, facts: readonly string[]): string[] {
  const allowed = numberTokens(facts.join('\n'), true)
  const used = numberTokens(answer)
  return [
    ...[...used.dayMonths].filter((token) => !allowed.dayMonths.has(token)),
    ...[...used.numbers].filter((token) => !allowed.numbers.has(token)),
  ]
}
