/**
 * Нормализация контактов из загружаемых файлов (решение 122): телефон, почта, ФИО,
 * ключ названия. Общие для загрузки вендоров и заказов с сайта — правило одно.
 */

/**
 * Российский мобильный или городской номер: 11 цифр, первая 7.
 *
 * Принимается «7 (999) 023-43-65», «+7 999 023-43-65», «8 999 023 43 65»,
 * «9990234365» (10 цифр без кода страны, код начинается с 3, 4, 8, 9). Всё остальное — `null`: угадывать
 * номер нельзя, ошибка в одной цифре — это чужой человек.
 */
export function normalizeRuPhoneDigits(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const text = String(raw).trim()
  if (text === '') return null
  // Разрешены только цифры, пробелы, скобки, дефисы, точки и плюс в начале.
  if (!/^\+?[\d\s()\-.]+$/.test(text)) return null
  const digits = text.replace(/\D/g, '')
  // 10 цифр — номер без кода страны. Российские коды начинаются с 3, 4, 8 или 9;
  // «7999023436» — это 11-значный номер с потерянной цифрой, а не код 799.
  if (digits.length === 10) return /^[3489]/.test(digits) ? `7${digits}` : null
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) return `7${digits.slice(1)}`
  return null
}

/** Номер для хранения у делового контакта: `+7XXXXXXXXXX`. */
export function formatPhoneE164(digits: string): string {
  return `+${digits}`
}

/**
 * Почта: без пробелов по краям, в нижнем регистре. Регистр в адресе на практике
 * не различается ни одним почтовым сервисом, а «Osipenko@mail.ru» и «osipenko@mail.ru»
 * без приведения стали бы двумя слушателями.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const text = String(raw).trim().toLowerCase()
  return text === '' ? null : text
}

/**
 * Проверка формата почты — разумная, не по всей RFC 5322: одна «@», непустая
 * локальная часть без пробелов, домен с точкой и зоной из букв.
 */
export function isValidEmail(email: string): boolean {
  if (email.length > 254) return false
  return /^[^\s@"<>(),;:\\[\]]+@[a-z0-9а-яё](?:[a-z0-9а-яё-]*[a-z0-9а-яё])?(?:\.[a-z0-9а-яё](?:[a-z0-9а-яё-]*[a-z0-9а-яё])?)*\.[a-zа-яё]{2,}$/iu.test(
    email,
  )
}

/**
 * Часть ФИО: пробелы по краям и повторные внутри убраны, каждая часть через дефис
 * с заглавной буквы — «петрова-водкина» → «Петрова-Водкина». Остальные буквы не
 * трогаются: «МакКуин» остаётся как есть.
 */
export function normalizeNamePart(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const text = String(raw).trim().replace(/\s+/g, ' ')
  if (text === '') return null
  return text
    .split(/([\s-])/)
    .map((part) => (part.length > 0 ? part[0]!.toLocaleUpperCase('ru') + part.slice(1) : part))
    .join('')
}

/** Похоже ли на часть имени: буквы, пробел, дефис, апостроф, точка. Цифр и «@» нет. */
export function isPlausibleNamePart(text: string): boolean {
  return /^[\p{L}][\p{L}\s'’.-]*$/u.test(text) && text.length <= 100
}

/** Кавычки, которые люди ставят вокруг названий: «ёлочки», „лапки“, "прямые", 'одинарные'. */
const QUOTES = /["'«»„“”‘’‚‹›]/g

/**
 * Ключ названия компании, продукта или курса для сопоставления.
 *
 * То же, что `skillNameKey` (решение 110: NFKC, нижний регистр, без пробелов),
 * плюс без кавычек: в файле вендоров продукт записан «Базис Dynamix», а в реестре —
 * Базис Dynamix; «ООО «Базис»» и «ООО "Базис"» — одна компания.
 */
export function catalogNameKey(name: string): string {
  return name.normalize('NFKC').toLocaleLowerCase('ru').replace(QUOTES, '').replace(/\s+/gu, '')
}

/** Название без внешних кавычек и лишних пробелов: «Базис Dynamix» → Базис Dynamix. */
export function stripOuterQuotes(name: string): string {
  let text = name.trim().replace(/\s+/g, ' ')
  while (text.length >= 2 && /^["'«„“]/.test(text) && /["'»“”]$/.test(text)) {
    text = text.slice(1, -1).trim()
  }
  return text
}
