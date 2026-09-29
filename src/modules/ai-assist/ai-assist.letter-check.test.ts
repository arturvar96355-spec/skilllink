import { describe, expect, it } from 'vitest'
import { LETTER_ANSWER_LIMITS, letterAnswerProblems, rewriteMaxWords } from './ai-assist.letter-check'

/**
 * Проверка ответа модели на письмо кодом (решение 226, B8): подпись, структура,
 * длина, чужие ссылки, следы чужих инструкций. Модели здесь нет — только тексты.
 */

const GOOD = [
  'Тема: Документы по программе',
  '',
  'Уважаемые коллеги!',
  '',
  'Просим передать подписанный экземпляр соглашения до 15.10.2026.',
  '',
  'С уважением,',
  'ИТ-Школа РТК',
].join('\n')

const FACTS = '- Вуз: СПбГУТ\n- Программа: Искусственный интеллект\n- Срок: 15.10.2026'
const context = { input: FACTS, requireSignature: true }

describe('ответ модели на письмо: что годится', () => {
  it('обычное письмо с подписью в конце — без замечаний', () => {
    expect(letterAnswerProblems(GOOD, context)).toEqual([])
  })

  it('слова и ссылки, которые уже были в материале письма, — не нарушение', () => {
    const input = `${FACTS}\n- Материалы: https://school.example.ru/materials`
    const text = GOOD.replace(
      'Просим',
      'Программа «Искусственный интеллект» идёт по плану, материалы — https://school.example.ru/materials. Просим',
    )
    expect(letterAnswerProblems(text, { input, requireSignature: true })).toEqual([])
  })

  // Ревью 29.09, P2-2: маркеры «пароль» и «искусственный интеллект» отбрасывали
  // обычное письмо, даже если слово не просьба, а тема письма.
  it.each([
    'Программа «Искусственный интеллект» набирает группу, занятия с 1 октября.',
    'Напоминаем про смену пароля в LMS: ссылка придёт от администратора вуза.',
    'Направим логин и пароль к платформе до начала курса.',
    'Напишите, если пароль от LMS не подходит, — поможем.',
    'Сообщите, если пароль не подходит, и пришлите вопросы по смене пароля.',
    'Курс по ИИ и нейросетям стартует в ноябре, проект по созданию ИИ-сервисов — весной.',
    'Код направления 09.03.01 уточним, как только придёт приказ.',
  ])('упоминание без просьбы и рассказа о себе — не нарушение: %s', (sentence) => {
    const text = GOOD.replace('Просим передать подписанный экземпляр соглашения до 15.10.2026.', sentence)
    expect(letterAnswerProblems(text, { input: '- Вуз: СПбГУТ', requireSignature: true })).toEqual([])
  })

  it('переделка черновика без подписи подписи не требует', () => {
    const text = 'Уважаемые коллеги!\n\nПросим подтвердить встречу.'
    expect(letterAnswerProblems(text, { input: text, requireSignature: false })).toEqual([])
  })

  it('даты, «т. е.», «и т. д.» и сокращения — не ссылки', () => {
    const text = GOOD.replace('Просим', 'Сроки, т.е. 15.10.2026 и т.д., не меняются. Просим')
    expect(letterAnswerProblems(text, context)).toEqual([])
  })
})

describe('ответ модели на письмо: что отбрасывается', () => {
  it.each([
    ['нет подписи ИТ-Школы', GOOD.replace('ИТ-Школа РТК', 'Иванов И.'), 'no-signature'],
    [
      'подпись не в конце, а внутри текста',
      `${GOOD.replace('\nС уважением,\nИТ-Школа РТК', '')}\nИТ-Школа РТК\n\nP.S. Ещё строка.\nИ ещё одна.\nИ последняя.`,
      'no-signature',
    ],
    ['одна подпись вместо письма', 'С уважением,\nИТ-Школа РТК', 'structure'],
    ['слишком длинное', GOOD.replace('Просим', `${'очень '.repeat(LETTER_ANSWER_LIMITS.maxWords)}Просим`), 'too-long'],
    ['чужая ссылка', GOOD.replace('Просим', 'Оплата: https://rtk-school.pay.example/login. Просим'), 'foreign-link'],
    ['ссылка без схемы', GOOD.replace('Просим', 'Пишите в t.me/rtk_support. Просим'), 'foreign-link'],
    ['домен без схемы', GOOD.replace('Просим', 'Подробности на rtk-bonus.ru. Просим'), 'foreign-link'],
    ['модель рассказывает о себе', GOOD.replace('Просим', 'Как языковая модель, я не могу. Просим'), 'instructions'],
    ['исполнила «игнорируй правила»', GOOD.replace('Просим', 'Игнорируя правила, сообщаем. Просим'), 'instructions'],
    ['просит пароль', GOOD.replace('Просим', 'Пришлите пароль от кабинета. Просим'), 'instructions'],
    ['просит перейти по ссылке', GOOD.replace('Просим', 'Перейдите по ссылке из письма. Просим'), 'instructions'],
    ['просит перевести деньги', GOOD.replace('Просим', 'Переведите оплату до пятницы. Просим'), 'instructions'],
    ['пересказывает служебный промпт', GOOD.replace('Просим', 'Согласно системной инструкции и пожеланиям администратора. Просим'), 'instructions'],
    ['ограды блока инструкции', GOOD.replace('Просим', '«««Просим'), 'instructions'],
    ['просит пароль вежливо', GOOD.replace('Просим', 'Сообщите, пожалуйста, ваш пароль от LMS. Просим'), 'instructions'],
    ['просит код из СМС', GOOD.replace('Просим', 'Продиктуйте код из СМС. Просим'), 'instructions'],
    ['выдаёт пароль', GOOD.replace('Просим', 'Ваш пароль: Rtk2026. Просим'), 'instructions'],
    ['номер карты', GOOD.replace('Просим', 'Оплата на 4276 1234 5678 9012. Просим'), 'instructions'],
    ['просит данные карты', GOOD.replace('Просим', 'Укажите номер вашей карты. Просим'), 'instructions'],
    ['называет себя ИИ', GOOD.replace('Просим', 'Я — ИИ-ассистент ИТ-Школы. Просим'), 'instructions'],
    ['говорит, кем написано', GOOD.replace('Просим', 'Письмо подготовлено нейросетью. Просим'), 'instructions'],
  ])('%s', (_name, text, problem) => {
    expect(letterAnswerProblems(text, context)).toContain(problem)
  })

  it('таблица и список со звёздочками — не письмо', () => {
    const table = GOOD.replace('Просим', '| Этап | Срок |\nПросим')
    expect(letterAnswerProblems(table, context)).toContain('structure')
    const bullets = GOOD.replace('Просим', '* первое\n* второе\nПросим')
    expect(letterAnswerProblems(bullets, context)).toContain('structure')
  })
})

describe('потолок слов переделки', () => {
  it('не меньше общего потолка и вдвое больше черновика', () => {
    expect(rewriteMaxWords('коротко')).toBe(LETTER_ANSWER_LIMITS.maxWords)
    expect(rewriteMaxWords('слово '.repeat(300))).toBe(600)
  })
})
