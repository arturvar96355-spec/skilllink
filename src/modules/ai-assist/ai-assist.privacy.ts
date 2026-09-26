/**
 * Персональные данные в модель не уходят (решение 90).
 *
 * В промпт идут только названия вуза, программы и продукта, номера и названия
 * этапов, статусы, дни, приоритеты и тексты правил. Правила пишут тексты без ПД,
 * кроме одного места: обоснование просрочки называет ответственного по ФИО.
 * Свободный текст — причину блокировки — пишет человек, и в нём бывает что угодно.
 *
 * Поэтому каждая строка перед отправкой проходит через `Redact`:
 *
 * 1. «Ответственный: Фамилия Имя Отчество.» вырезается целиком;
 * 2. почта и телефоны заменяются пометкой;
 * 3. ФИО сотрудников и контактных лиц вузов, известные базе, — словом
 *    «ответственный» или «представитель вуза», в любом падеже и с инициалами;
 * 4. «Фамилия И. О.» и «И. О. Фамилия» — даже если человека в базе нет.
 *
 * Официальные названия (вуз «имени М. А. Бонч-Бруевича») при этом не трогаются:
 * их передаёт вызывающий код, и они прячутся от замены на время обработки.
 */

export type Redact = (text: string) => string

export interface KnownPeople {
  /** ФИО сотрудников ИТ-Школы. */
  staff: readonly string[]
  /** ФИО контактных лиц и представителей вузов. */
  contacts: readonly string[]
}

export const STAFF_PLACEHOLDER = 'ответственный'
export const CONTACT_PLACEHOLDER = 'представитель вуза'
const EMAIL_PLACEHOLDER = '[адрес скрыт]'
const PHONE_PLACEHOLDER = '[телефон скрыт]'

const LETTERS = 'A-Za-zА-Яа-яЁё'
const NOT_LETTER_BEFORE = `(?<![${LETTERS}])`
const NOT_LETTER_AFTER = `(?![${LETTERS}])`

/**
 * «Ответственный: Кириллов Пётр Андреевич.» — из обоснования просрочки (правило
 * stage.overdue); и «Ответственный: Кириллов П. А.». Имя — до трёх слов с заглавной
 * или фамилия с инициалами: следующее предложение после точки не задевается.
 */
const RESPONSIBLE_CLAUSE =
  /\s*[Оо]тветственн(?:ый|ая|ое|ые)\s*[:—–-]\s*[А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+){0,2}(?:\s+[А-ЯЁ]\.\s?(?:[А-ЯЁ]\.)?)?[.;]?/g

export const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu

/** Кандидат в телефон: цифры со скобками, пробелами и дефисами. Точек нет — это даты. */
export const PHONE_CANDIDATE = /(?:\+\s?)?\d[\d\s()\-–]{8,}\d/g
export const MIN_PHONE_DIGITS = 10
export const MAX_PHONE_DIGITS = 15

/** «Иванов И. И.», «Иванов И.И.» */
export const SURNAME_WITH_INITIALS = new RegExp(
  `${NOT_LETTER_BEFORE}[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\\s+[А-ЯЁ]\\.\\s?(?:[А-ЯЁ]\\.)?`,
  'g',
)
/** «И. И. Иванов», «И.И. Иванов» */
export const INITIALS_WITH_SURNAME = new RegExp(
  `${NOT_LETTER_BEFORE}[А-ЯЁ]\\.\\s?(?:[А-ЯЁ]\\.\\s?)?[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?${NOT_LETTER_AFTER}`,
  'g',
)

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Основа слова для склонений: «Савельева» → «Савельев», «Ольга» → «Ольг». */
function stem(word: string): string {
  return word.length > 3 && /[аяоеёыийьу]$/i.test(word) ? word.slice(0, -1) : word
}

/**
 * Шаблон одной части ФИО в любом падеже: основа и до трёх букв окончания,
 * «е» и «ё» взаимозаменяемы. Первая буква — как в базе: имена пишутся с заглавной,
 * и строчное «белых» не спутается с фамилией «Белых».
 */
export function namePartPattern(part: string): string | null {
  const clean = part.replace(/[^A-Za-zА-Яа-яЁё-]/g, '')
  if (clean.length < 3) return null
  const base = escapeRegExp(stem(clean)).replace(/[её]/g, '[её]').replace(/[ЕЁ]/g, '[ЕЁ]')
  return `${NOT_LETTER_BEFORE}${base}[а-яё]{0,3}${NOT_LETTER_AFTER}`
}

function peoplePattern(names: readonly string[]): RegExp | null {
  const parts = new Set<string>()
  for (const name of names) {
    for (const part of name.trim().split(/\s+/)) {
      const pattern = namePartPattern(part)
      if (pattern) parts.add(pattern)
    }
  }
  if (parts.size === 0) return null
  // Длинные основы первыми: «Петренко» не должна съесться короче совпавшей «Петр».
  const ordered = [...parts].sort((a, b) => b.length - a.length)
  return new RegExp(ordered.join('|'), 'g')
}

/** «ответственный ответственный П. А.» → «ответственный». */
function collapse(text: string, placeholder: string): string {
  const word = escapeRegExp(placeholder)
  return text
    .replace(new RegExp(`[А-ЯЁ]\\.\\s?(?:[А-ЯЁ]\\.\\s?)?${word}`, 'g'), placeholder)
    .replace(new RegExp(`${word}(?:\\s+${word})+`, 'g'), placeholder)
    .replace(new RegExp(`${word}\\s+[А-ЯЁ]\\.(?:\\s?[А-ЯЁ]\\.)?`, 'g'), placeholder)
}

function redactPhones(text: string): string {
  return text.replace(PHONE_CANDIDATE, (candidate) => {
    const digits = candidate.replace(/\D/g, '').length
    return digits >= MIN_PHONE_DIGITS && digits <= MAX_PHONE_DIGITS ? PHONE_PLACEHOLDER : candidate
  })
}

/**
 * Готовая функция очистки строки.
 *
 * `keep` — официальные названия, которые встречаются в тексте и должны дойти
 * до модели как есть: вуз, программа, продукт, навык, этап.
 */
export function createRedactor(people: KnownPeople, keep: readonly string[] = []): Redact {
  const staff = peoplePattern(people.staff)
  const contacts = peoplePattern(people.contacts)
  const protectedNames = [...new Set(keep.map((name) => name.trim()).filter((name) => name.length > 0))]
    // Длинные первыми: «СПбГУТ» не должно разрезать полное название, в котором оно встречается.
    .sort((a, b) => b.length - a.length)

  return (text: string): string => {
    // Названия прячутся за символами из области для частного использования:
    // это не буквы и не цифры, ни одно правило ниже их не заденет.
    let result = text
    protectedNames.forEach((name, index) => {
      result = result.split(name).join(`\uE000${index}\uE001`)
    })

    result = result.replace(RESPONSIBLE_CLAUSE, '')
    result = result.replace(EMAIL, EMAIL_PLACEHOLDER)
    result = redactPhones(result)
    if (staff) result = result.replace(staff, STAFF_PLACEHOLDER)
    if (contacts) result = result.replace(contacts, CONTACT_PLACEHOLDER)
    result = collapse(collapse(result, STAFF_PLACEHOLDER), CONTACT_PLACEHOLDER)
    result = result.replace(SURNAME_WITH_INITIALS, STAFF_PLACEHOLDER)
    result = result.replace(INITIALS_WITH_SURNAME, STAFF_PLACEHOLDER)
    result = collapse(result, STAFF_PLACEHOLDER)

    result = result.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => protectedNames[Number(index)]!)
    return result.replace(/[ \t]{2,}/g, ' ').trim()
  }
}

/** Очистка всех строк структуры фактов — вложенных объектов и массивов тоже. */
export function redactDeep<T>(value: T, redact: Redact): T {
  if (typeof value === 'string') return redact(value) as T
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, redact)) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactDeep(item, redact)]),
    ) as T
  }
  return value
}
