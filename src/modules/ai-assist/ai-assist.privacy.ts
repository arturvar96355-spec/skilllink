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
 * 7. «Имя Отчество Фамилия» в прямом порядке, «Фамилия Имя Отчество» в обратном
 *    (решение 226) и «Имя Отчество» без фамилии — даже если человека в базе нет
 *    (последнее — решение 222).
 *    Опорное слово — отчество (оканчивается на «-вич», «-вна» или «-ична» в любом
 *    падеже): такое окончание почти никогда не встречается в названиях вузов и
 *    программ, поэтому ложных срабатываний на «Информационная безопасность» или
 *    похожие названия нет.
 *
 * 8. Дата рождения с опорным словом («дата рождения 01.02.1980», «д.р.»,
 *    «родилась в 1980 году», «1980 г.р.») и почтовый адрес — после слова «адрес»
 *    целиком, без него — связка «улица + дом» или номер квартиры (решение 226).
 *
 * После маскировки весь промпт ещё раз проверяется на признаки персональных данных
 * (`findPersonalData`, решение 226) — проверка нарочно шире масок: то, что маска
 * не смогла аккуратно заменить, не уходит в модель, а останавливает запрос.
 *
 * Официальные названия (вуз «имени М. А. Бонч-Бруевича») при этом не трогаются:
 * их передаёт вызывающий код, и они прячутся от замены на время обработки —
 * поэтому «Бонч-Бруевича» с окончанием, похожим на отчество, не режется.
 */

/**
 * Функция очистки строки. У редактора из `createRedactor` есть и остаточная проверка
 * `findPersonalData` — с теми же спрятанными официальными названиями, что у маски.
 */
export interface Redact {
  (text: string): string
  findPersonalData?: (text: string) => PersonalDataKind[]
}

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
const BIRTH_DATE_PLACEHOLDER = '[дата рождения скрыта]'
const POSTAL_ADDRESS_PLACEHOLDER = '[почтовый адрес скрыт]'

/** Все пометки маскировки — по ним проверяется, не дописала ли модель пометку, которой не было во входе. */
export const MASK_PLACEHOLDERS = [
  EMAIL_PLACEHOLDER,
  PHONE_PLACEHOLDER,
  PASSPORT_PLACEHOLDER,
  SNILS_PLACEHOLDER,
  NICK_PLACEHOLDER,
  BIRTH_DATE_PLACEHOLDER,
  POSTAL_ADDRESS_PLACEHOLDER,
] as const

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
 *
 * После опоры — только падежные окончания отчества, а не любые буквы: иначе
 * прилагательные на «-ичн-»/«-овн-» с заглавной («Откройте Личный кабинет»,
 * «Программа Основная образовательная», «Курс Публичная Политика») принимались
 * за имя с отчеством и становились «ответственный» (ревью 29.09, P2-1).
 * Женские «-на/-ны/-не/-ну» у прилагательных не бывает («-ная», «-ный», «-ное»,
 * «-ную», «-ные», «-ных»…), совпадает только творительный «-ной/-ною»
 * («Ивановной» и «Основной») — он вынесен в `PATRONYMIC_INSTRUMENTAL` и
 * засчитывается, только если имя перед ним тоже в творительном падеже.
 */
const PATRONYMIC = `[А-ЯЁ][а-яё]*(?:вич(?:а|у|ем|е)?|(?:ов|ев|ич)н[аыеу])`
/** «Ивановной», «Ильиничною» — пишется одинаково с прилагательным «Основной». */
const PATRONYMIC_INSTRUMENTAL = `[А-ЯЁ][а-яё]*(?:ов|ев|ич)н(?:ой|ою)`
/** Имя в творительном падеже: «Марией», «Ольгой», «Любовью», «Натальею». */
const NAME_INSTRUMENTAL = `[А-ЯЁ][а-яё]*(?:[ео]й|[ео]ю|ью)`
/** Имя и отчество подряд: «Иван Петрович», «Ольге Сергеевне», «Марией Ивановной». */
const NAME_AND_PATRONYMIC = `(?:[А-ЯЁ][а-яё]+\\s+(?:${PATRONYMIC})|${NAME_INSTRUMENTAL}\\s+(?:${PATRONYMIC_INSTRUMENTAL}))`

/** «Иван Петрович Сидоров» — ФИО в прямом порядке, без инициалов, любой падеж. */
export const FULL_NAME_DIRECT = new RegExp(
  `${NOT_LETTER_BEFORE}${NAME_AND_PATRONYMIC}\\s+[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?${NOT_LETTER_AFTER}`,
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
  `${NOT_LETTER_BEFORE}${NAME_AND_PATRONYMIC}${NOT_LETTER_AFTER}`,
  'g',
)

/**
 * Фамилия по окончанию: «-ов/-ев/-ин» (и падежи), «-ский/-цкий», «-ых/-их», «-енко»,
 * «-ук/-юк», «-ян», «-дзе», «-швили». Нужна для ФИО в обратном порядке: слово
 * с заглавной перед «Имя Отчество» бывает и глаголом в начале предложения
 * («Передайте Ивану Ивановичу»), и обращением («Уважаемый Иван Иванович»), — их
 * терять нельзя, а у фамилий без такого окончания («Мельник») граница честная.
 */
const SURNAME = `[А-ЯЁ][а-яё]*(?:(?:[оеё]в|[иы]н)(?:а|у|ым|ой|ою|е|ы|ых|ыми)?|[сц]к(?:ий|ая|ой|ого|ому|им|ом|ую|ие|их|ими)|ых|их|енко|ко|[ую]к|ян|дзе|швили)(?:-[А-ЯЁ][а-яё]+)?`

/** Пробелы внутри одной строки: ФИО не собирается из концов двух разных строк. */
const INLINE_SPACE = '[ \\t\\u00A0]+'

/** «Иванов Иван Иванович», «Ивановой Марии Сергеевне» — ФИО в обратном порядке (решение 226). */
export const FULL_NAME_REVERSED = new RegExp(
  // Фамилия по окончанию — опора надёжнее отчества, поэтому здесь творительный «-ной» без условий.
  `${NOT_LETTER_BEFORE}${SURNAME}${INLINE_SPACE}[А-ЯЁ][а-яё]+${INLINE_SPACE}(?:${PATRONYMIC}|${PATRONYMIC_INSTRUMENTAL})${NOT_LETTER_AFTER}`,
  'g',
)

/** Отчество прописными: «ИВАНОВИЧ», «ПЕТРОВНА», «ИЛЬИНИЧНА». */
const UPPER_PATRONYMIC = '[А-ЯЁ]+(?:ВИЧ(?:А|У|ЕМ|Е)?|(?:ОВ|ЕВ|ИЧ)Н[АЫЕУ])'
const UPPER_WORD = '[А-ЯЁ]{2,}(?:-[А-ЯЁ]{2,})?'

/** «ИВАНОВ ИВАН ИВАНОВИЧ» и «ИВАН ИВАНОВИЧ ИВАНОВ» — так ФИО пишут в анкетах и списках. */
export const FULL_NAME_UPPER = new RegExp(
  `(?<![A-Za-zА-Яа-яЁё])(?:${UPPER_WORD}${INLINE_SPACE}${UPPER_WORD}${INLINE_SPACE}${UPPER_PATRONYMIC}|${UPPER_WORD}${INLINE_SPACE}${UPPER_PATRONYMIC}${INLINE_SPACE}${UPPER_WORD})(?![A-Za-zА-Яа-яЁё])`,
  'g',
)

// ─────────────────────────── Дата рождения (решение 226) ─────────────────────

const MONTHS = '(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)'
/** «01.02.1980», «1.2.80», «01/02/1980», «01-02-1980», «1 февраля 1980», «1980». */
const DATE_VALUE = `(?:\\d{1,2}[./-]\\d{1,2}[./-](?:\\d{4}|\\d{2})|\\d{1,2}\\s+${MONTHS}(?:\\s+\\d{4})?|(?:19|20)\\d{2})(?!\\d)`
const YEAR_SUFFIX = '(?:\\s*(?:г\\.|года|году|год)(?![а-яё]))?'
/** Опорные слова перед датой: «дата рождения», «д.р.», «д/р», «родился», «рождён», «год рождения», «г.р.». */
const BIRTH_MARKER = `(?:дат[аеуы]\\s+рождения|д\\.\\s?р\\.|д/р|родил(?:ся|ась|ись)|рожд[её]н[аы]?|год[ау]?\\s+рождения|г\\.\\s?р\\.)`

/** «дата рождения: 01.02.1980», «родилась в 1980 году», «д.р. 1 февраля 1980 г.» */
export const BIRTH_DATE_AFTER_MARKER = new RegExp(
  `${NOT_LETTER_BEFORE}${BIRTH_MARKER}\\s*[:—–-]?\\s*(?:(?:в|во)\\s+)?${DATE_VALUE}${YEAR_SUFFIX}`,
  'gi',
)
/** «1980 г.р.», «01.02.1980 г. р.», «1980 года рождения» */
export const BIRTH_DATE_BEFORE_MARKER = new RegExp(
  `(?<!\\d)${DATE_VALUE}\\s*(?:г\\.\\s?р\\.|г\\.\\s*рождения|года\\s+рождения)`,
  'gi',
)

// ─────────────────────────── Почтовый адрес (решение 226) ────────────────────

/** Первая буква — любого регистра: «ул.» и «Ул.» в начале предложения. */
function eitherCase(words: readonly string[]): string {
  return `(?:${words.map((word) => `[${word[0]!.toUpperCase()}${word[0]}]${word.slice(1)}`).join('|')})`
}

const STREET_TYPE = eitherCase([
  'ул\\.', 'улиц[аеуы]', 'пр-кт', 'пр-т', 'просп\\.', 'проспект[аеу]?', 'пр\\.', 'пер\\.', 'переул(?:ок|ка|ке)',
  'ш\\.', 'шоссе', 'б-р', 'бул\\.', 'бульвар[аеу]?', 'наб\\.', 'набережн(?:ая|ой|ую)', 'пл\\.', 'площад[ьи]',
  'проезд[аеу]?', 'мкр\\.?', 'микрорайон[аеу]?', 'туп\\.', 'тупик[аеу]?',
])
const CAPITALIZED = '[А-ЯЁ][а-яё]+(?:-[А-ЯЁа-яё][а-яё]+)*'
/**
 * «ул. Ленина», «ул. 1-я Советская», «пр. К. Маркса», «пр. Большевиков», «Невский пр.»,
 * «Каширское шоссе».
 */
const STREET = `(?:${STREET_TYPE}\\s*(?:\\d{1,3}-?[а-яё]{0,2}\\s+)?(?:[А-ЯЁ]\\.\\s?){0,2}${CAPITALIZED}(?:\\s+${CAPITALIZED}){0,2}|${CAPITALIZED}(?:\\s+${CAPITALIZED})?\\s+${STREET_TYPE})`
/** «д. 5», «дом 12А», «д. 5/2». */
const HOUSE = `${eitherCase(['д\\.', 'дом(?![а-яё])'])}\\s*№?\\s*\\d{1,4}[А-Яа-яЁё]?(?:\\s*[/-]\\s*\\d{1,4}[А-Яа-яЁё]?)?(?![\\dА-Яа-яЁё])`
/** «корп. 2», «стр. 1», «лит. А». */
const BUILDING = `${eitherCase(['корп\\.', 'корпус', 'стр\\.', 'строение', 'лит\\.', 'литер[аы]?'])}\\s*№?\\s*(?:\\d{1,4}[А-Яа-яЁё]?|[А-ЯЁ])(?![\\dА-Яа-яЁё])`
/**
 * «кв. 12», «квартира 7». «кв.» с годом после — квартал, а не квартира: «3 кв. 2026 года».
 * «кв. м» без цифры сразу после — площадь.
 */
const FLAT = `${eitherCase(['кв\\.?', 'квартир[аеуы]'])}\\s*№?\\s*(?!(?:19|20)\\d{2}(?!\\d))\\d{1,5}[А-Яа-яЁё]?(?![\\dА-Яа-яЁё])`
/** «оф. 301», «офис 5», «пом. 4» — адрес только рядом с домом: «в офисе 5 человек» — не адрес. */
const OFFICE = `${eitherCase(['оф\\.', 'офис[аеу]?', 'пом\\.', 'помещени[еия]'])}\\s*№?\\s*\\d{1,5}[А-Яа-яЁё]?(?![\\dА-Яа-яЁё])`
const POSTCODE = '(?<!\\d)\\d{6}(?!\\d)'
const CITY = `${eitherCase(['г\\.', 'город[аеу]?'])}\\s*${CAPITALIZED}(?:\\s+${CAPITALIZED})?`
const REGION = `${CAPITALIZED}\\s+(?:обл\\.|область|област[иь]|кра[йяю]|р-н|район[аеу]?)`
const ADDRESS_PART = `(?:${STREET}|${HOUSE}|${BUILDING}|${FLAT}|${OFFICE}|${POSTCODE}|${CITY}|${REGION})`
const ADDRESS_SEPARATOR = '(?:\\s*,\\s*|\\s+)'

/**
 * После слова «адрес» берётся вся цепочка частей адреса, включая голое название
 * города («Москва»): «адрес регистрации: Москва, ул. Ленина, д. 5, кв. 12».
 * Слово «адрес» остаётся, цепочка заменяется пометкой.
 */
const ADDRESS_MARKER = `${eitherCase(['адрес[ауе]?', 'прописк[аеуи]'])}(?:\\s+(?:регистрации|проживания|прописки|места\\s+(?:жительства|пребывания)|фактического\\s+проживания|доставки))?\\s*[:—–-]?\\s*`
export const ADDRESS_AFTER_MARKER = new RegExp(
  `(${NOT_LETTER_BEFORE}${ADDRESS_MARKER})((?:${ADDRESS_PART}|${CAPITALIZED})(?:${ADDRESS_SEPARATOR}(?:${ADDRESS_PART}|${CAPITALIZED}))*)`,
  'g',
)

/** Цепочка частей адреса без слова «адрес»: маскируется, только если в ней есть дом при улице или квартира. */
export const ADDRESS_CHAIN = new RegExp(
  `${NOT_LETTER_BEFORE}${ADDRESS_PART}(?:${ADDRESS_SEPARATOR}${ADDRESS_PART})*`,
  'g',
)
const HAS_ADDRESS_PART = new RegExp(`${NOT_LETTER_BEFORE}${ADDRESS_PART}`)
const HAS_STREET = new RegExp(STREET)
const HAS_HOUSE = new RegExp(`${NOT_LETTER_BEFORE}${HOUSE}`)
const HAS_FLAT = new RegExp(`${NOT_LETTER_BEFORE}${FLAT}`)
const HAS_CITY_OR_POSTCODE = new RegExp(`${NOT_LETTER_BEFORE}(?:${CITY}|${POSTCODE})`)

/**
 * Похоже ли на адрес: квартира или дом при улице (городе, индексе). Одна улица
 * без дома — не адрес: «ул. Гагарина» бывает частью названия организации.
 */
function looksLikeAddress(chain: string): boolean {
  if (HAS_FLAT.test(chain)) return true
  return HAS_HOUSE.test(chain) && (HAS_STREET.test(chain) || HAS_CITY_OR_POSTCODE.test(chain))
}

function redactAddresses(text: string): string {
  return text
    .replace(ADDRESS_AFTER_MARKER, (match, marker: string, chain: string) =>
      // «в адрес Министерства» — слово «адрес» без единой части адреса после него не трогается.
      HAS_ADDRESS_PART.test(chain) ? `${marker}${POSTAL_ADDRESS_PLACEHOLDER}` : match,
    )
    .replace(ADDRESS_CHAIN, (chain) => (looksLikeAddress(chain) ? POSTAL_ADDRESS_PLACEHOLDER : chain))
}

// ─────────────────────── Телефон с опорным словом (решение 226) ──────────────

/** «тел. 555-12-34», «моб.: 12-34-56» — короткий городской номер: без опорного слова его не отличить от числа. */
export const PHONE_WITH_MARKER = new RegExp(
  `(${NOT_LETTER_BEFORE}(?:тел\\.?|телефон[аеу]?|моб\\.?|мобильн(?:ый|ого|ому)|сот\\.|сотов(?:ый|ого|ому)|whatsapp|ватсап|вотсап)\\s*[:.—–-]?\\s*)(?:\\+\\s?)?\\d[\\d\\s()\\-–]{3,}\\d`,
  'gi',
)

/** Короче пяти цифр после «тел.» — не номер, а, например, добавочный. */
const MIN_MARKED_PHONE_DIGITS = 5

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

function countMatches(pattern: RegExp | null, text: string): number {
  return pattern ? [...text.matchAll(pattern)].length : 0
}

/**
 * Чьё это ФИО: частей контакта вуза больше, чем частей сотрудника, — «представитель вуза»,
 * иначе «ответственный» (так было и раньше, когда части из базы заменялись первыми).
 */
function placeholderFor(span: string, staff: RegExp | null, contacts: RegExp | null): string {
  return countMatches(contacts, span) > countMatches(staff, span) ? CONTACT_PLACEHOLDER : STAFF_PLACEHOLDER
}

function redactPhones(text: string): string {
  return text
    .replace(PHONE_CANDIDATE, (candidate) => {
      const digits = candidate.replace(/\D/g, '').length
      return digits >= MIN_PHONE_DIGITS && digits <= MAX_PHONE_DIGITS ? PHONE_PLACEHOLDER : candidate
    })
    .replace(PHONE_WITH_MARKER, (match, marker: string) =>
      match.replace(/\D/g, '').length >= MIN_MARKED_PHONE_DIGITS ? `${marker}${PHONE_PLACEHOLDER}` : match,
    )
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

  const redact = (text: string): string => {
    // Названия прячутся за символами из области для частного использования:
    // это не буквы и не цифры, ни одно правило ниже их не заденет.
    let result = text
    protectedNames.forEach((name, index) => {
      result = result.split(name).join(`\uE000${index}\uE001`)
    })

    result = result.replace(RESPONSIBLE_CLAUSE, '')
    result = result.replace(EMAIL, EMAIL_PLACEHOLDER)
    // Дата рождения — раньше адреса: «д.р.» иначе начало бы адрес с «д.» (дом).
    result = result.replace(BIRTH_DATE_AFTER_MARKER, BIRTH_DATE_PLACEHOLDER)
    result = result.replace(BIRTH_DATE_BEFORE_MARKER, BIRTH_DATE_PLACEHOLDER)
    // Адрес — раньше телефона и документов: индекс и номера домов не должны уйти с их пометками.
    result = redactAddresses(result)
    // Паспорт и СНИЛС — раньше телефона: те же 10–11 цифр иначе ушли бы с чужой пометкой.
    result = result.replace(PASSPORT_CANDIDATE, PASSPORT_PLACEHOLDER)
    result = result.replace(SNILS_CANDIDATE, SNILS_PLACEHOLDER)
    result = redactPhones(result)
    result = result.replace(NICKNAME, NICK_PLACEHOLDER)
    // ФИО целиком — раньше частей из базы: иначе «Смирнова Ольга Петровна» при известной
    // базе «Ольге» стала бы «Смирнова ответственный Петровна», и фамилия ушла бы в модель
    // (решение 226). Прямой порядок — раньше обратного: в «Уважаемая Ольга Сергеевна
    // Смирнова» обратное правило взяло бы «Уважаемая» за фамилию.
    for (const pattern of [FULL_NAME_UPPER, FULL_NAME_DIRECT, FULL_NAME_REVERSED, NAME_WITH_PATRONYMIC]) {
      result = result.replace(pattern, (span) => placeholderFor(span, staff, contacts))
    }
    if (staff) result = result.replace(staff, STAFF_PLACEHOLDER)
    if (contacts) result = result.replace(contacts, CONTACT_PLACEHOLDER)
    result = collapse(collapse(result, STAFF_PLACEHOLDER), CONTACT_PLACEHOLDER)
    result = result.replace(SURNAME_WITH_INITIALS, STAFF_PLACEHOLDER)
    result = result.replace(INITIALS_WITH_SURNAME, STAFF_PLACEHOLDER)
    result = collapse(result, STAFF_PLACEHOLDER)

    result = result.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => protectedNames[Number(index)]!)
    return result.replace(/[ \t]{2,}/g, ' ').trim()
  }
  return Object.assign(redact, { findPersonalData: (text: string) => findPersonalData(text, protectedNames) })
}

// ─────────────────────── Остаточная проверка (решение 226) ───────────────────

/** Какие признаки персональных данных нашлись в тексте, уже прошедшем маскировку. */
export const PERSONAL_DATA_KINDS = ['email', 'phone', 'document', 'birth-date', 'address', 'full-name'] as const
export type PersonalDataKind = (typeof PERSONAL_DATA_KINDS)[number]

const PLACEHOLDERS_IN_TEXT = new RegExp(MASK_PLACEHOLDERS.map(escapeRegExp).join('|'), 'g')

/** «555-12-34» — городской номер без кода и без опорного слова. */
const LOCAL_PHONE = /(?<![\d.,])\d{3}-\d{2}-\d{2}(?![\d.,-])/
/** «дата рождения: 01 02 1980» — опорное слово и цифры рядом, в любом виде. */
const BIRTH_DATE_LOOSE = new RegExp(
  `${NOT_LETTER_BEFORE}(?:дат[аеуы]\\s+рождения|д\\.\\s?р\\.|д/р|г\\.\\s?р\\.|год[ау]?\\s+рождения)[^\\d\\n]{0,15}\\d`,
  'i',
)
/** «ул Ленина 5», «пр-т Мира, 12» — улица и номер дома без «д.». */
const STREET_WITH_NUMBER = new RegExp(
  `${NOT_LETTER_BEFORE}${eitherCase(['ул', 'улиц[аеуы]', 'пр-кт', 'пр-т', 'пр', 'просп', 'проспект[аеу]?', 'пер', 'переул(?:ок|ка|ке)'])}\\.?\\s+(?:[А-ЯЁ]\\.\\s?){0,2}${CAPITALIZED}(?:\\s+${CAPITALIZED})?,?\\s+(?:${eitherCase(['д\\.?', 'дом'])}\\s*)?\\d{1,4}(?![\\d.:])`,
)
const INN = /(?<![А-Яа-яЁё])ИНН\s*[:№]?\s*\d{10}(?:\d{2})?(?!\d)/
/** 16 цифр — номер карты или полиса ОМС: длиннее телефона, маска их не узнаёт, но отправлять нельзя. */
const CARD_OR_POLICY = /(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g

function hasPhone(text: string): boolean {
  for (const [candidate] of text.matchAll(PHONE_CANDIDATE)) {
    const digits = candidate.replace(/\D/g, '').length
    if (digits >= MIN_PHONE_DIGITS && digits <= MAX_PHONE_DIGITS) return true
  }
  for (const [match] of text.matchAll(PHONE_WITH_MARKER)) {
    if (match.replace(/\D/g, '').length >= MIN_MARKED_PHONE_DIGITS) return true
  }
  return LOCAL_PHONE.test(text)
}

function hasAddress(text: string): boolean {
  for (const [chain] of text.matchAll(ADDRESS_CHAIN)) {
    if (looksLikeAddress(chain)) return true
  }
  return STREET_WITH_NUMBER.test(text)
}

/**
 * Остаточная проверка перед отправкой в модель: признаки персональных данных,
 * которые пережили маскировку, — телефон, почта, номер документа, дата рождения,
 * адрес с домом или квартирой, ФИО из трёх слов. Проверка шире масок: маска
 * заменяет только то, что узнаёт уверенно, а здесь достаточно признака — запрос
 * с ним не уходит, человек сам убирает данные (решение 226).
 *
 * `keep` — официальные названия, как у `createRedactor`: «имени М. А. Бонч-Бруевича»
 * не признак, а название вуза. Пометки маскировки («[телефон скрыт]») — тоже нет.
 */
export function findPersonalData(text: string, keep: readonly string[] = []): PersonalDataKind[] {
  let scan = text
  for (const name of [...keep].sort((a, b) => b.length - a.length)) {
    if (name.trim()) scan = scan.split(name).join('\uE000')
  }
  scan = scan.replace(PLACEHOLDERS_IN_TEXT, '\uE000')

  const found: PersonalDataKind[] = []
  if (scan.search(EMAIL) !== -1) found.push('email')
  // Номер документа — не телефон, хоть в нём и те же 10–12 цифр: у признака одно имя.
  const withoutDocuments = scan
    .replace(new RegExp(INN.source, 'g'), '\uE000')
    .replace(CARD_OR_POLICY, '\uE000')
    .replace(PASSPORT_CANDIDATE, '\uE000')
    .replace(SNILS_CANDIDATE, '\uE000')
  if (hasPhone(withoutDocuments)) found.push('phone')
  if (withoutDocuments !== scan) found.push('document')
  if (
    scan.search(BIRTH_DATE_AFTER_MARKER) !== -1 ||
    scan.search(BIRTH_DATE_BEFORE_MARKER) !== -1 ||
    BIRTH_DATE_LOOSE.test(scan)
  ) {
    found.push('birth-date')
  }
  if (hasAddress(scan)) found.push('address')
  if (
    scan.search(FULL_NAME_DIRECT) !== -1 ||
    scan.search(FULL_NAME_REVERSED) !== -1 ||
    scan.search(FULL_NAME_UPPER) !== -1
  ) {
    found.push('full-name')
  }
  return found
}

/** Остаточная проверка тем же редактором, что маскировал: с его официальными названиями. */
export function personalDataLeft(redact: Redact, text: string): PersonalDataKind[] {
  return redact.findPersonalData ? redact.findPersonalData(text) : findPersonalData(text)
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
