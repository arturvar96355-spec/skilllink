/**
 * Персональные данные в модель не уходят (решение 90, дополнено решением 183).
 *
 * В промпт идут только названия вуза, программы и продукта, номера и названия
 * этапов, статусы, дни, приоритеты и тексты правил. Правила пишут тексты без ПД,
 * кроме одного места: обоснование просрочки называет ответственного по ФИО.
 * Свободный текст — причину блокировки, текст письма вуза — пишет человек,
 * и в нём бывает что угодно: полное ФИО в прямом порядке, ник в мессенджере,
 * номер документа.
 *
 * Поэтому каждая строка перед отправкой проходит через `Redact`:
 *
 * 1. «Ответственный: Фамилия Имя Отчество.» вырезается целиком;
 * 2. почта и телефоны заменяются пометкой;
 * 3. паспорт РФ (серия и номер, 4+6 цифр) и СНИЛС — пометкой;
 * 4. ник в мессенджере («@mkuz») — пометкой;
 * 5. ФИО сотрудников и контактных лиц вузов, известные базе, — словом
 *    «ответственный» или «представитель вуза», в любом падеже и с инициалами;
 * 6. «Фамилия И. О.» и «И. О. Фамилия» — даже если человека в базе нет;
 * 7. «Имя Отчество Фамилия» в прямом порядке и «Имя Отчество» без фамилии —
 *    даже если человека в базе нет (второе — решение 222).
 *    Опорное слово — отчество (оканчивается на «-вич», «-вна» или «-ична» в любом
 *    падеже): такое окончание почти никогда не встречается в названиях вузов и
 *    программ, поэтому ложных срабатываний на «Информационная безопасность» или
 *    похожие названия нет.
 *
 * Официальные названия (вуз «имени М. А. Бонч-Бруевича») при этом не трогаются:
 * их передаёт вызывающий код, и они прячутся от замены на время обработки —
 * поэтому «Бонч-Бруевича» с окончанием, похожим на отчество, не режется.
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
const PASSPORT_PLACEHOLDER = '[паспорт скрыт]'
const SNILS_PLACEHOLDER = '[СНИЛС скрыт]'
const NICK_PLACEHOLDER = '[ник скрыт]'

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

/**
 * Паспорт РФ: серия (4 цифры, часто как 2+2) и номер (6 цифр), с пробелами или без —
 * «4514 123456», «45 14 123456», «4514123456». Проверяется раньше телефона: 10 цифр
 * подряд иначе ушли бы с пометкой «телефон», а это тоже документ, который скрывать надёжнее.
 */
export const PASSPORT_CANDIDATE = /(?<!\d)\d{2}\s?\d{2}\s?\d{6}(?!\d)/g

/** СНИЛС: три группы по три цифры и две цифры контрольного числа — с дефисами, пробелами или без. */
export const SNILS_CANDIDATE = /(?<!\d)\d{3}[-\s]?\d{3}[-\s]?\d{3}[-\s]?\d{2}(?!\d)/g

/** Ник в мессенджере или соцсети — «@mkuz». Проверяется после почты: в почте «@» уже заменён. */
export const NICKNAME = /(?<![\wа-яёА-ЯЁ@.])@[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9_]{1,31}\b/gu

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

/**
 * Отчество на «-вич» (мужское) или «-вна»/«-ична» (женское) в любом падеже. Мужское
 * склоняется добавлением букв после «вич» («Петрович» → «Петровича», «Петровичу») —
 * литеральный кусок «вич» переживает все падежи. Женское склоняется заменой последней
 * буквы («Ивановна» → «Ивановны», «Ивановне», «Ивановну», «Ивановной») — переживает
 * только более короткая опора «овн»/«евн» (и «ичн» у «Ильинична» и его пары), поэтому
 * для женского берётся она, а не буквы «на» целиком. Опорные буквосочетания почти
 * не встречаются ни в чём, кроме отчества, поэтому не путаются с названиями вузов
 * и программ, если те не разбиты по словам искусственно.
 */
const PATRONYMIC = `[А-ЯЁ][а-яё]*(?:вич|(?:ов|ев)н|ичн)[а-яё]{0,3}`

/** «Иван Петрович Сидоров» — ФИО в прямом порядке, без инициалов, любой падеж. */
export const FULL_NAME_DIRECT = new RegExp(
  `${NOT_LETTER_BEFORE}[А-ЯЁ][а-яё]+\\s+(?:${PATRONYMIC})\\s+[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?${NOT_LETTER_AFTER}`,
  'g',
)

/**
 * «Иван Петрович», «Ольге Сергеевне» — имя и отчество без фамилии (решение 222).
 * Так обращаются к человеку в письме («Уважаемая Ольга Сергеевна!»), и такой
 * текст сотрудник сам вписывает в черновик перед переделкой кнопками или в
 * инструкцию администратора. Проверяется после ФИО из трёх слов, опора — то же
 * отчество: названия вузов и программ такого окончания не содержат, а официальные
 * названия («имени Бонч-Бруевича») спрятаны от замены раньше.
 */
export const NAME_WITH_PATRONYMIC = new RegExp(
  `${NOT_LETTER_BEFORE}[А-ЯЁ][а-яё]+\\s+(?:${PATRONYMIC})${NOT_LETTER_AFTER}`,
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
  // Часть «ФИО» со строчной буквы — не имя, а обычное слово: у демо-учётки
  // «Эксперт — представитель вуза» слово «вуза» иначе резало «с вузом» в любом
  // тексте до «с представитель вуза» (решение 213).
  if (!/^[A-ZА-ЯЁ]/.test(clean)) return null
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
    // Паспорт и СНИЛС — раньше телефона: те же 10–11 цифр иначе ушли бы с чужой пометкой.
    result = result.replace(PASSPORT_CANDIDATE, PASSPORT_PLACEHOLDER)
    result = result.replace(SNILS_CANDIDATE, SNILS_PLACEHOLDER)
    result = redactPhones(result)
    result = result.replace(NICKNAME, NICK_PLACEHOLDER)
    if (staff) result = result.replace(staff, STAFF_PLACEHOLDER)
    if (contacts) result = result.replace(contacts, CONTACT_PLACEHOLDER)
    result = collapse(collapse(result, STAFF_PLACEHOLDER), CONTACT_PLACEHOLDER)
    result = result.replace(SURNAME_WITH_INITIALS, STAFF_PLACEHOLDER)
    result = result.replace(INITIALS_WITH_SURNAME, STAFF_PLACEHOLDER)
    result = result.replace(FULL_NAME_DIRECT, STAFF_PLACEHOLDER)
    result = result.replace(NAME_WITH_PATRONYMIC, STAFF_PLACEHOLDER)
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
