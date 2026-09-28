import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seedInboundLetters } from '../../../prisma/demo/inbound-letters'
import { buildAnalysisPrompt, buildReplyDraftPrompt } from '@/modules/inbound-letters/inbound-letters.prompts'
import { classifyByRules } from '@/modules/inbound-letters/inbound-letters.rules'
import { createRedactor, findPersonalData, MASK_PLACEHOLDERS, personalDataLeft } from './ai-assist.privacy'
import { buildRewritePrompt, LETTER_SAFETY_RULES, letterRulesTail, REWRITE_TASKS } from './ai-assist.prompts'

/**
 * Маскировка перед моделью: дата рождения, почтовый адрес, ФИО в обратном порядке
 * и остаточная проверка (решение 226). Таблицы «вход → ожидаемый текст», таблица
 * того, что трогать нельзя, и прогон всех демо-писем вузов из сида.
 */

const SEED = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf8')
const CATALOG = readFileSync(join(process.cwd(), 'prisma/demo/catalog.ts'), 'utf8')
const SEED_NAMES = [...SEED.matchAll(/fullName: '([^']+)'/g)].map((match) => match[1]!)
/** Официальные названия вузов демо-набора — их маскировка не трогает, как в `findRedactionContext`. */
const UNIVERSITY_NAMES = [...`${SEED}\n${CATALOG}`.matchAll(/(?:name|shortName): '([^']+)'/g)].map((match) => match[1]!)

const BONCH = 'Университет телекоммуникаций им. проф. М. А. Бонч-Бруевича'

function redactor() {
  return createRedactor({ staff: SEED_NAMES, contacts: SEED_NAMES }, [...UNIVERSITY_NAMES, BONCH])
}

describe('маскировка: что теперь заменяется (решение 226)', () => {
  const redact = redactor()

  it.each([
    // Дата рождения — с опорным словом до или после даты.
    ['дата рождения 01.02.1980', '[дата рождения скрыта]'],
    ['Дата рождения: 01.02.1980.', '[дата рождения скрыта].'],
    ['Студент (д.р. 15.03.2001) просит перевод.', 'Студент ([дата рождения скрыта]) просит перевод.'],
    ['д. р. 1.2.80, группа 3', '[дата рождения скрыта], группа 3'],
    ['родилась в 1980 году', '[дата рождения скрыта]'],
    ['родился 1 февраля 1980 года, учится на 3 курсе', '[дата рождения скрыта], учится на 3 курсе'],
    ['Анкета: 1985 г.р., стаж 10 лет', 'Анкета: [дата рождения скрыта], стаж 10 лет'],
    ['1990 года рождения', '[дата рождения скрыта]'],
    // Адрес после слова «адрес» — целиком, с голым названием города.
    [
      'адрес регистрации: Москва, ул. Ленина, д. 5, кв. 12.',
      'адрес регистрации: [почтовый адрес скрыт].',
    ],
    [
      'Адрес: 190000, г. Санкт-Петербург, Невский пр., д. 28, корп. 2, стр. 1, оф. 301',
      'Адрес: [почтовый адрес скрыт]',
    ],
    [
      'Оригинал — по адресу: 630073, г. Новосибирск, пр. К. Маркса, д. 20, корп. 1.',
      'Оригинал — по адресу: [почтовый адрес скрыт].',
    ],
    // Адрес без слова «адрес» — дом при улице или квартира.
    ['Проживает: ул. Ленина, д. 5, кв. 12; всё верно.', 'Проживает: [почтовый адрес скрыт]; всё верно.'],
    ['Живёт на пер. Садовый, дом 3', 'Живёт на [почтовый адрес скрыт]'],
    ['Москва, Каширское шоссе, д. 31', 'Москва, [почтовый адрес скрыт]'],
    ['кв. 45 — в том же доме', '[почтовый адрес скрыт] — в том же доме'],
    // ФИО в обратном порядке — любой падеж.
    ['Иванов Иван Иванович, студент 2 курса', 'ответственный, студент 2 курса'],
    ['Ректору Иванову Ивану Ивановичу', 'Ректору ответственный'],
    ['Сообщаем Смирновой Ольге Петровне о переносе.', 'Сообщаем ответственный о переносе.'],
    ['Вишневский Андрей Петрович подписал', 'ответственный подписал'],
    ['Шевченко Мария Ильинична на связи', 'ответственный на связи'],
    ['ИВАНОВ ИВАН ИВАНОВИЧ', 'ответственный'],
    ['ИВАН ИВАНОВИЧ ИВАНОВ, декан', 'ответственный, декан'],
    // Прямой порядок раньше обратного: обращение не принимается за фамилию.
    ['Уважаемая Ольга Сергеевна Смирнова!', 'Уважаемая ответственный!'],
    // Короткий номер после «тел.».
    ['тел. 555-12-34, доб. 123', 'тел. [телефон скрыт], доб. 123'],
    ['моб.: 12-34-56', 'моб.: [телефон скрыт]'],
    // Всё сразу — пример из замечания Codex.
    [
      'Иванов Иван Иванович, дата рождения 01.02.1980, адрес регистрации: Москва, ул. Ленина, д. 5, кв. 12.',
      'ответственный, [дата рождения скрыта], адрес регистрации: [почтовый адрес скрыт].',
    ],
  ])('%s', (input, expected) => {
    expect(redact(input)).toBe(expected)
  })
})

describe('маскировка: что трогать нельзя', () => {
  const redact = redactor()

  it.each([
    'Уважаемые коллеги!',
    'С уважением,',
    'ИТ-Школа РТК',
    'Встреча в корпусе на ул. Гагарина. Приезжайте к 10:00.',
    'Технопарк «ул. Гагарина» — партнёр программы.',
    'План на 3 кв. 2026 года, площадь 150 кв. м, в офисе 5 человек.',
    'Направляем в адрес Министерства письмо; ответ — в адрес вуза.',
    'Срок 30.07.2026, прошло 57 д., 5 из 13.',
    'Прошло 12 д. 3 этапа из 11; и пр. Документы; стр. 5 приложения.',
    'Договор от 01.02.2024 № 15, приложение №2.',
    'Проект рождён в команде ИТ-Школы РТК.',
    'Программа «Информационная безопасность», этап 6 «Подписание договора».',
    'Прикладная информатика и программирование — совместная программа.',
    `Вуз: ${BONCH}.`,
    'Балтийский федеральный университет им. Иммануила Канта',
    'Национальный исследовательский Нижегородский государственный университет им. Н. И. Лобачевского',
    'Благодарим за письмо. Приступаем со следующей недели.',
  ])('%s', (input) => {
    expect(redact(input)).toBe(input)
  })

  it('обращение и глагол перед «Имя Отчество» — не фамилия', () => {
    expect(redact('Уважаемый Иван Иванович!')).toBe('Уважаемый ответственный!')
    expect(redact('Передайте Ивану Ивановичу.')).toBe('Передайте ответственный.')
    expect(redact('Благодарим Ольгу Петровну за помощь.')).toBe('Благодарим ответственный за помощь.')
  })
})

describe('остаточная проверка: что остановит отправку', () => {
  it.each([
    ['дата рождения: 01 02 1980', ['birth-date']],
    ['д/р — 1 2 80', ['birth-date']],
    ['проживает на ул Ленина 5-12', ['address']],
    ['пр-т Мира, 12', ['address']],
    ['ул. Ленина, д. 5', ['address']],
    ['Иванов Иван Иванович', ['full-name']],
    ['Иван Иванович Петров', ['full-name']],
    ['ИВАНОВ ИВАН ИВАНОВИЧ', ['full-name']],
    ['звоните 555-12-34', ['phone']],
    ['+7 900 000-00-00', ['phone']],
    ['ivanov@mail.example', ['email']],
    ['паспорт 4514 123456', ['document']],
    ['СНИЛС 112-233-445 95', ['document']],
    ['ИНН 500100732259', ['document']],
    ['карта 2200 1234 5678 9010', ['document']],
    ['полис ОМС 7700123456789012', ['document']],
  ] as const)('%s → %j', (text, kinds) => {
    expect(findPersonalData(text)).toEqual(kinds)
  })

  it.each([
    'Уважаемые коллеги!',
    'ответственный, [дата рождения скрыта], адрес регистрации: [почтовый адрес скрыт].',
    'Звонить [телефон скрыт], писать [адрес скрыт], паспорт [паспорт скрыт], СНИЛС [СНИЛС скрыт], [ник скрыт].',
    'Срок 30.07.2026, прошло 57 дн., этап 6 из 11, 45 000 рублей, 120 студентов.',
    'План на 3 кв. 2026 года, площадь 150 кв. м.',
    'Уважаемый ответственный!',
  ])('чисто: %s', (text) => {
    expect(findPersonalData(text)).toEqual([])
  })

  it('официальные названия с «-вича» не признак: редактор проверяет со своими названиями', () => {
    const name = 'Университет имени Петра Алексеевича Иванова'
    expect(findPersonalData(`Вуз: ${name}`)).toEqual(['full-name'])
    const redact = createRedactor({ staff: [], contacts: [] }, [name])
    expect(redact(`Вуз: ${name}`)).toBe(`Вуз: ${name}`)
    expect(personalDataLeft(redact, `Вуз: ${name}`)).toEqual([])
  })

  it('после маскировки таблицы выше не остаётся ничего', () => {
    const redact = redactor()
    const text = [
      'Иванов Иван Иванович, дата рождения 01.02.1980, адрес регистрации: Москва, ул. Ленина, д. 5, кв. 12.',
      'ИВАН ИВАНОВИЧ ИВАНОВ, тел. 555-12-34, ivanov@mail.example, паспорт 4514 123456.',
      'Проживает: ул. Ленина, д. 5, кв. 12; 1985 г.р.',
    ].join('\n')
    expect(personalDataLeft(redact, redact(text))).toEqual([])
  })

  it('служебные тексты промптов сами по себе чистые — иначе отказ был бы у каждого запроса', () => {
    const texts = [
      letterRulesTail(null, (text) => text),
      ...LETTER_SAFETY_RULES,
      ...Object.values(REWRITE_TASKS),
      ...MASK_PLACEHOLDERS,
    ]
    for (const text of texts) expect(findPersonalData(text), text).toEqual([])
  })
})

// ─────────────────────── Демо-письма вузов из сида ──────────────────────────

interface DemoLetter {
  subject: string
  bodyText: string
}

/** Все письма демо-набора — ровно то, что пишет сид: база подменена записью вызовов. */
async function demoLetters(): Promise<DemoLetter[]> {
  const letters: DemoLetter[] = []
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, method: string) => async (args: { data?: DemoLetter }) => {
          if (name === 'inboundLetter' && method === 'create' && args.data) letters.push(args.data)
          return { id: `${name}-${letters.length}` }
        },
      },
    )
  const prisma = new Proxy({}, { get: (_target, name: string) => model(name) })
  const now = new Date('2026-09-28T09:00:00Z')
  const keys = [
    'spbgu-spbgu-infosec',
    'spbgu-spbgu-soft',
    'mtuci-mtuci-data',
    'kazan-kazan-devops',
    'kazan-kazan-infosec',
    'nsu-nsu-ai',
    'urfu-urfu-security',
    'urfu-urfu-appl',
    'rostov-rostov-it',
    'rostov-rostov-infosec',
  ]
  await seedInboundLetters(prisma as never, {
    now,
    daysAgo: (days) => new Date(now.getTime() - days * 86_400_000),
    universityId: (key) => key,
    cooperations: keys.map((key) => ({ key, id: key, universityKey: key.split('-')[0]! })),
    manager: 'manager-1',
    manager2: 'manager-2',
  })
  return letters
}

describe('демо-письма вузов: маскировка не портит, модель вызывается', () => {
  it('все письма сида проходят маскировку без изменений и без отказа', async () => {
    const letters = await demoLetters()
    expect(letters.length).toBeGreaterThanOrEqual(14)
    const redact = redactor()

    for (const letter of letters) {
      expect(redact(letter.subject), letter.subject).toBe(letter.subject.trim())
      for (const line of letter.bodyText.split('\n').filter((item) => item.trim() !== '')) {
        expect(redact(line), line).toBe(line.trim().replace(/[ \t]{2,}/g, ' '))
      }

      const fallback = classifyByRules(`${letter.subject}\n${letter.bodyText}`)
      const analysis = buildAnalysisPrompt(
        { subject: letter.subject, body: letter.bodyText, universityName: 'СПбГУТ', stageInfo: 'этап 6 из 11', examples: [] },
        fallback,
        redact,
      )
      expect(personalDataLeft(redact, `${analysis.system}\n${analysis.user}`), letter.subject).toEqual([])

      const reply = buildReplyDraftPrompt(
        { universityName: 'СПбГУТ', subject: letter.subject, group: fallback.group, action: fallback.action },
        redact,
      )
      expect(personalDataLeft(redact, `${reply.system}\n${reply.user}`), letter.subject).toEqual([])
      // Шаблон ответа проходит ту же проверку, что ответ модели (решение 226, B8).
      expect(reply.problems!(reply.template), letter.subject).toEqual([])
      // Шаблон ответа — то, что сотрудник потом переделывает кнопками: он тоже не должен вызывать отказ.
      const rewrite = buildRewritePrompt({ kind: 'inbound-letter-reply', text: reply.template, style: 'softer' }, redact)
      expect(rewrite.masked, letter.subject).toBe(false)
      expect(personalDataLeft(redact, `${rewrite.system}\n${rewrite.user}`), letter.subject).toEqual([])
    }
  })

  it('три примера «до/после» на демо-письмах с дописанными персональными данными', async () => {
    const letters = await demoLetters()
    const redact = redactor()
    const bySubject = (subject: string) => letters.find((letter) => letter.subject === subject)!.bodyText

    // 1. «Документы по программе» (НГТУ) + адрес для оригинала и контакт в обратном порядке.
    const documents = `${bySubject('Документы по программе')} Оригинал направьте по адресу: 630073, г. Новосибирск, пр. К. Маркса, д. 20, корп. 1. Контакт — Смирнова Ольга Петровна, тел. 346-50-01.`
    expect(redact(documents)).toBe(
      'Просим выслать оригинал соглашения и приложения к нему — юридический отдел вуза просит подписанный экземпляр для внутреннего архива. Оригинал направьте по адресу: [почтовый адрес скрыт]. Контакт — ответственный, тел. [телефон скрыт].',
    )

    // 2. «Нужно взять паузу» (СПбГУТ) + студентка с датой рождения и адресом регистрации.
    const pause = `${bySubject('Нужно взять паузу')} Заявление Кузнецовой Анны Сергеевны (д.р. 12.04.2004, адрес регистрации: Санкт-Петербург, ул. Ленина, д. 5, кв. 12) приложено.`
    expect(redact(pause)).toBe(
      'Добрый день! К сожалению, из-за загрузки кафедры в этом семестре нам нужно взять паузу по этапу повышения квалификации — вернёмся к нему после зимней сессии. Заявление ответственный ([дата рождения скрыта], адрес регистрации: [почтовый адрес скрыт]) приложено.',
    )

    // 3. «Предлагаем обсудить итоги семестра» — без персональных данных остаётся как есть.
    const results = bySubject('Предлагаем обсудить итоги семестра')
    expect(redact(results)).toBe(results)
  })
})
