/**
 * Проверка ответа модели на письмо вузу кодом, а не текстом промпта (решение 226, B8).
 *
 * Базовые правила писем (`LETTER_SAFETY_RULES`) стоят в промпте после инструкции
 * администратора и названы главнее неё — но это просьба к модели, а не гарантия.
 * Враждебная или неудачная инструкция («добавь ссылку на оплату», «подпишись
 * Ивановым») и модель, которая ей поддалась, дают письмо, которое уйти вузу не
 * должно. Здесь то же проверяется детерминированно, после ответа: нарушение —
 * ответ отбрасывается, сотрудник видит шаблон с пометкой «ответ модели не прошёл
 * проверку» (`fallbackReason: "invalid"`).
 *
 * Персональные данные в ответе проверяет сам конвейер (`compose`) для любого вида
 * черновика — здесь только то, что относится к письму.
 */

const SIGNATURE = /ИТ[\s\-‑–]?Школ/i

export const LETTER_ANSWER_LIMITS = {
  /**
   * Длиннее — не письмо, а что-то другое. Длину по умолчанию (120–170 слов) может
   * поменять инструкция администратора, этот потолок — нет.
   */
  maxWords: 400, // TEMP
  /** Подпись «ИТ-Школа РТК» ищется в последних строках письма, а не где угодно в тексте. */
  signatureTailLines: 3,
  /** Меньше слов вне подписи — письма нет, одна подпись («ИТ-Школа РТК» в ответ на всё). */
  minBodyWords: 2,
} as const

export type LetterAnswerProblem =
  | 'no-signature'
  | 'structure'
  | 'too-long'
  | 'foreign-link'
  | 'instructions'

export interface LetterAnswerContext {
  /**
   * То, что сотрудник и система дали модели как материал письма: факты или черновик
   * (пользовательская часть промпта). Ссылка или слово, которые были в нём, — не чужие.
   * Инструкция администратора сюда не входит: её и проверяем.
   */
  input: string
  /** Требовать подпись «ИТ-Школа РТК». У переделки — только если она была в черновике. */
  requireSignature: boolean
  /** Потолок слов; у переделки «Подробнее» — с запасом от длины черновика. */
  maxWords?: number
}

/** Ссылки: схема, «www.», домен с распространённой зоной, t.me. */
const LINK = /(?:https?:\/\/|www\.)[^\s«»"'<>)]+|(?<![@\w.-])(?:[a-zа-яё0-9-]+\.)+(?:ru|рф|su|com|net|org|io|me|info|biz|pro|online|site|xyz|app|dev|link|ly|to|cc)(?:\/[^\s«»"'<>)]*)?(?![\w-])/giu

/**
 * Признаки того, что модель исполнила чужую инструкцию или выдала служебное:
 * рассказ о себе и о промпте, просьбы о паролях, кодах и деньгах, призыв перейти
 * по ссылке. Слово из этого списка, которое уже было в материале письма (например,
 * программа «Искусственный интеллект»), нарушением не считается.
 */
const INSTRUCTION_MARKERS: readonly RegExp[] = [
  /языков\S*\s+модел/i,
  /нейросет/i,
  /искусственн\S*\s+интеллект/i,
  /(?<![А-Яа-яЁё])ИИ(?![А-Яа-яЁё])/,
  /промпт|prompt/i,
  // Не любое «инструкция» (методические бывают в письме), а служебная: «системные инструкции».
  /(?:предыдущ|системн|скрыт|внутренн)\S*\s+инструкци/i,
  /инструкци\S*\s+(?:выше|для\s+(?:модели|ИИ))/i,
  /(?:пожелани|инструкци)\S*\s+администратор/i,
  /обязательн\S*\s+правил/i,
  /игнорир/i,
  /«««|»»»/,
  /парол/i,
  /код\S*\s+(?:из|в)\s+(?:смс|sms|сообщени)/i,
  /номер\S*\s+карт|cvv|cvc/i,
  /перевед\S*\s+(?:деньги|средства|оплат|сумм)/i,
  /перейд\S*\s+по\s+ссылк/i,
]

const words = (text: string) => text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length

function normalizeLink(link: string): string {
  return link.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/.,;:!?]+$/, '')
}

/** Что не так с ответом модели на письмо. Пустой список — письмо годится. */
export function letterAnswerProblems(text: string, context: LetterAnswerContext): LetterAnswerProblem[] {
  const problems: LetterAnswerProblem[] = []
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

  if (context.requireSignature) {
    const tail = lines.slice(-LETTER_ANSWER_LIMITS.signatureTailLines)
    if (!tail.some((line) => SIGNATURE.test(line))) problems.push('no-signature')
  }

  // Письмо — несколько строк и текст кроме подписи; не таблица и не список со звёздочками.
  const body = lines.filter((line) => !SIGNATURE.test(line) && !/^с уважением/i.test(line)).join(' ')
  if (
    lines.length < 2 ||
    words(body) < LETTER_ANSWER_LIMITS.minBodyWords ||
    lines.some((line) => /^\|/.test(line) || /^[*•]\s/.test(line))
  ) {
    problems.push('structure')
  }

  if (words(text) > (context.maxWords ?? LETTER_ANSWER_LIMITS.maxWords)) problems.push('too-long')

  const known = new Set([...context.input.matchAll(LINK)].map((match) => normalizeLink(match[0])))
  if ([...text.matchAll(LINK)].some((match) => !known.has(normalizeLink(match[0])))) problems.push('foreign-link')

  if (INSTRUCTION_MARKERS.some((marker) => marker.test(text) && !marker.test(context.input))) {
    problems.push('instructions')
  }
  return problems
}

/** Потолок слов переделки: письмо «Подробнее» вправе вырасти вдвое от черновика. */
export function rewriteMaxWords(draft: string): number {
  return Math.max(LETTER_ANSWER_LIMITS.maxWords, words(draft) * 2)
}
