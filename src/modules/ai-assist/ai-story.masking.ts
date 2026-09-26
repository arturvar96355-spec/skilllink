import {
  EMAIL,
  INITIALS_WITH_SURNAME,
  MAX_PHONE_DIGITS,
  MIN_PHONE_DIGITS,
  PHONE_CANDIDATE,
  SURNAME_WITH_INITIALS,
  namePartPattern,
  type KnownPeople,
} from './ai-assist.privacy'

/**
 * Обратимое обезличивание для «Истории сотрудничества» и плана (решение 138).
 *
 * `createRedactor` из решения 90 заменяет ФИО словом «ответственный» навсегда:
 * черновику письма имена не нужны. Здесь иначе: модель получает факты
 * с типизированными метками — `[КОНТАКТ_1]`, `[СОТРУДНИК_2]`, `[ПОЧТА_1]`,
 * `[ТЕЛЕФОН_1]`, `[ЛИЦО_1]` (человек, которого нет в базе, но видно по «Фамилия И. О.»),
 * а после ответа метки возвращаются исходными строками — ровно теми, что стояли
 * в тексте. Сотрудник видит свой же текст, в модель уходят только метки.
 *
 * Одна и та же строка в разных фактах получает одну метку: модель понимает,
 * что это один человек. Разные падежи одного человека — разные метки: возвращается
 * ровно то, что было написано, без попыток склонять.
 *
 * Официальные названия (вуз «имени М. А. Бонч-Бруевича») не трогаются: их передаёт
 * вызывающий код, и на время обработки они прячутся за символами из области
 * для частного использования — как в `createRedactor`.
 */

export const MASK_LABEL_TYPES = ['КОНТАКТ', 'СОТРУДНИК', 'ПОЧТА', 'ТЕЛЕФОН', 'ЛИЦО'] as const
export type MaskLabelType = (typeof MASK_LABEL_TYPES)[number]

/** Любая метка в тексте: «[КОНТАКТ_1]». */
export const MASK_LABEL = /\[(КОНТАКТ|СОТРУДНИК|ПОЧТА|ТЕЛЕФОН|ЛИЦО)_(\d{1,4})\]/g

/**
 * Телефон РФ в любом привычном виде: +7 (812) 555-12-34, 8 812 555 12 34,
 * 8-999-123-45-67, +79991234567, 88125551234. Общий кандидат из решения 90
 * (10–15 цифр со скобками и дефисами) ловит остальное.
 */
const RU_PHONE = /(?<![\d+])(?:\+\s?7|8)[\s\-–]?\(?\d{3}\)?[\s\-–]?\d{3}[\s\-–]?\d{2}[\s\-–]?\d{2}(?!\d)/g

const INITIALS = '[А-ЯЁ]\\.\\s?(?:[А-ЯЁ]\\.)?'

/**
 * ФИО из известного списка — целиком: «Ветрова Ирина Павловна», «Ветровой И. П.»,
 * «И. П. Ветрова», «Ирина Павловна». Части имени идут подряд (до трёх), с инициалами
 * спереди или сзади. Каждая часть — в любом падеже (`namePartPattern`).
 */
function fullNamePattern(names: readonly string[]): RegExp | null {
  const parts = new Set<string>()
  for (const name of names) {
    for (const part of name.trim().split(/\s+/)) {
      const pattern = namePartPattern(part)
      if (pattern) parts.add(pattern)
    }
  }
  if (parts.size === 0) return null
  // Длинные основы первыми: «Петренко» не должна съесться короче совпавшей «Петр».
  const alternatives = `(?:${[...parts].sort((a, b) => b.length - a.length).join('|')})`
  return new RegExp(
    `(?:${INITIALS}\\s?)?${alternatives}(?:\\s+${alternatives}){0,2}(?:\\s+${INITIALS})?`,
    'g',
  )
}

export interface Masker {
  /** Заменяет ПДн метками. Одинаковые строки — одинаковыми метками. */
  mask(text: string): string
  /** Возвращает метки исходными строками. Незнакомая метка остаётся как есть. */
  restore(text: string): string
  /** Метки в тексте, которых маскировщик не выдавал: модель их выдумала. */
  unknownLabels(text: string): string[]
  /** Сколько меток выдано — для журнала и проверок. */
  size(): number
}

/** Токены на время обработки: не буквы и не цифры, ни одно правило их не заденет. */
const KEEP_OPEN = ''
const KEEP_CLOSE = ''
const LABEL_OPEN = ''
const LABEL_CLOSE = ''

/**
 * `people.staff` — сотрудники ИТ-Школы, `people.contacts` — контактные лица
 * и представители вузов. `keep` — официальные названия, которые должны дойти
 * до модели как есть.
 */
export function createMasker(people: KnownPeople, keep: readonly string[] = []): Masker {
  const contacts = fullNamePattern(people.contacts)
  const staff = fullNamePattern(people.staff)
  const protectedNames = [...new Set(keep.map((name) => name.trim()).filter((name) => name.length > 0))]
    .sort((a, b) => b.length - a.length)

  /** Выданные метки: «[ПОЧТА_1]» → исходная строка, и обратно. */
  const byLabel = new Map<string, string>()
  const byValue = new Map<string, string>()
  const counters = new Map<MaskLabelType, number>()
  /** Метки текущего вызова `mask` — по номеру в токене. */
  const pending: string[] = []

  function labelFor(type: MaskLabelType, value: string): string {
    const key = `${type}\u0000${value}`
    let label = byValue.get(key)
    if (!label) {
      const next = (counters.get(type) ?? 0) + 1
      counters.set(type, next)
      label = `[${type}_${next}]`
      byValue.set(key, label)
      byLabel.set(label, value)
    }
    pending.push(label)
    return `${LABEL_OPEN}${pending.length - 1}${LABEL_CLOSE}`
  }

  function replaceWith(text: string, pattern: RegExp, type: MaskLabelType, accept?: (value: string) => boolean): string {
    return text.replace(new RegExp(pattern.source, pattern.flags), (match: string) => {
      if (accept && !accept(match)) return match
      // Пробелы по краям совпадения — не часть имени: метка встаёт вместо сути.
      const leading = /^\s*/.exec(match)![0]
      const trailing = /\s*$/.exec(match)![0]
      const core = match.slice(leading.length, match.length - trailing.length)
      return `${leading}${labelFor(type, core)}${trailing}`
    })
  }

  function mask(text: string): string {
    pending.length = 0
    let result = text
    protectedNames.forEach((name, index) => {
      result = result.split(name).join(`${KEEP_OPEN}${index}${KEEP_CLOSE}`)
    })

    result = replaceWith(result, EMAIL, 'ПОЧТА')
    result = replaceWith(result, RU_PHONE, 'ТЕЛЕФОН')
    result = replaceWith(result, PHONE_CANDIDATE, 'ТЕЛЕФОН', (candidate) => {
      const digits = candidate.replace(/\D/g, '').length
      return digits >= MIN_PHONE_DIGITS && digits <= MAX_PHONE_DIGITS
    })
    if (contacts) result = replaceWith(result, contacts, 'КОНТАКТ')
    if (staff) result = replaceWith(result, staff, 'СОТРУДНИК')
    result = replaceWith(result, SURNAME_WITH_INITIALS, 'ЛИЦО')
    result = replaceWith(result, INITIALS_WITH_SURNAME, 'ЛИЦО')

    result = result.replace(
      new RegExp(`${LABEL_OPEN}(\\d+)${LABEL_CLOSE}`, 'g'),
      (_match, index: string) => pending[Number(index)]!,
    )
    return result.replace(
      new RegExp(`${KEEP_OPEN}(\\d+)${KEEP_CLOSE}`, 'g'),
      (_match, index: string) => protectedNames[Number(index)]!,
    )
  }

  function restore(text: string): string {
    return text.replace(new RegExp(MASK_LABEL.source, 'g'), (label: string) => byLabel.get(label) ?? label)
  }

  function unknownLabels(text: string): string[] {
    return [...text.matchAll(new RegExp(MASK_LABEL.source, 'g'))]
      .map((match) => match[0])
      .filter((label) => !byLabel.has(label))
  }

  return { mask, restore, unknownLabels, size: () => byLabel.size }
}

/** Есть ли в тексте почта или телефон — то, чего в ответе модели быть не может. */
export function containsContactDetails(text: string): boolean {
  if (new RegExp(EMAIL.source, EMAIL.flags.replace('g', '')).test(text)) return true
  if (new RegExp(RU_PHONE.source).test(text)) return true
  for (const match of text.matchAll(new RegExp(PHONE_CANDIDATE.source, 'g'))) {
    const digits = match[0].replace(/\D/g, '').length
    if (digits >= MIN_PHONE_DIGITS && digits <= MAX_PHONE_DIGITS) return true
  }
  return false
}
