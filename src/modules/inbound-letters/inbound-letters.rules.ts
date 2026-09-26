import { validationError } from '@/shared/http/errors'
import type { InboundLetterGroup } from '@/shared/contracts/enums'
import { INBOUND_LETTER_GROUP_LABELS } from '@/shared/contracts/labels'
import {
  MAX_EML_SIZE_BYTES,
  MAX_QUOTES,
  QUOTE_MAX_LENGTH,
  RULES_FALLBACK_CONFIDENCE,
  RULES_MAX_CONFIDENCE,
} from '@/shared/config/inbound-letters.config'

/** Ответ 422 на файл больше предела — тот же приём, что у файлов документов (`attachments.rules.ts`). */
export function letterFileTooLarge() {
  const megabytes = Math.floor(MAX_EML_SIZE_BYTES / (1024 * 1024))
  return validationError('Файл письма слишком большой', [
    { field: 'file', message: `Допустимо не больше ${megabytes} МБ` },
  ])
}

/**
 * Разбор письма по ключевым словам — запасной путь без модели (решение 170):
 * либо модель выключена/не настроена/подвела, либо это первый проход до её вызова.
 *
 * Чистая функция без обращения к базе — принимает уже готовый текст письма.
 */

/**
 * Ключевые слова по группе — деловая переписка вуза с ИТ-Школой. Порядок в массиве —
 * порядок проверки при равном числе совпадений (первая победившая группа устойчива
 * к порядку перечисления `Object.entries`).
 */
const KEYWORD_GROUPS: ReadonlyArray<{ group: InboundLetterGroup; keywords: readonly string[] }> = [
  {
    group: 'PAUSE_OR_REFUSAL',
    keywords: [
      'приостан', 'отказ', 'откаж', 'не смож', 'не готов', 'перенес.. на след',
      'прекра', 'отменя', 'отмени', 'не сможем продолжить', 'заморо', 'не будем продолжать',
    ],
  },
  {
    group: 'MEETING',
    keywords: [
      'встреч', 'созвон', 'видеозвонок', 'видеоконференц', 'обсудить очно', 'предлагаем встретиться',
      'согласовать время', 'удобное время для звонка', 'по зуму', 'по скайпу', 'по телемосту',
    ],
  },
  {
    group: 'DOCUMENTS',
    keywords: [
      'документ', 'договор', 'скан', 'подписан', 'приложен', 'выслать оригинал', 'соглашени',
      'акт', 'счёт', 'счет', 'лицензи', 'реквизит',
    ],
  },
  {
    group: 'STAGE_SHIFT',
    keywords: [
      'этап', 'перешли к', 'завершили', 'приступа', 'готовы начать', 'начинаем', 'запустили',
      'программа согласована', 'учебный план утверждён', 'учебный план утвержден', 'приказ издан',
    ],
  },
  {
    group: 'QUESTION',
    keywords: ['вопрос', 'уточнить', 'подскажите', 'уточните', 'интересует', 'не совсем понятно', 'разъясните'],
  },
]

/** Действие по умолчанию для группы — короткая фраза ответственному. */
const DEFAULT_ACTIONS: Record<InboundLetterGroup, string> = {
  STAGE_SHIFT: 'Проверить и подтвердить переход к новому этапу связки',
  DOCUMENTS: 'Проверить и оформить документы, о которых пишет вуз',
  MEETING: 'Согласовать время и провести встречу с вузом',
  QUESTION: 'Ответить на вопрос вуза',
  PAUSE_OR_REFUSAL: 'Связаться с вузом и уточнить причину паузы или отказа',
  OTHER: 'Прочитать письмо и решить, что делать дальше',
}

export function defaultActionFor(group: InboundLetterGroup): string {
  return DEFAULT_ACTIONS[group]
}

export function groupLabel(group: InboundLetterGroup): string {
  return INBOUND_LETTER_GROUP_LABELS[group]
}

/** Разбивает текст на предложения — грубо, но достаточно для цитат-оснований. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text
}

export interface RuleClassification {
  group: InboundLetterGroup
  action: string
  confidence: number
  quotes: string[]
}

/**
 * Классификация по ключевым словам. Считает совпадения по каждой группе (по числу
 * различных ключевых слов, встретившихся хоть раз — не по общему числу вхождений:
 * одно и то же слово, повторённое три раза, не должно перевешивать три разных
 * признака паузы), берёт группу с максимумом; при полном отсутствии совпадений —
 * `OTHER` с низкой уверенностью. Цитаты — предложения, где встретилось совпадение.
 */
export function classifyByRules(text: string): RuleClassification {
  const lower = text.toLowerCase()
  const sentences = splitSentences(text)

  let best: { group: InboundLetterGroup; score: number; matchedWords: string[] } | null = null
  for (const { group, keywords } of KEYWORD_GROUPS) {
    const matchedWords = keywords.filter((keyword) => new RegExp(keyword, 'i').test(lower))
    if (matchedWords.length === 0) continue
    if (!best || matchedWords.length > best.score) {
      best = { group, score: matchedWords.length, matchedWords }
    }
  }

  if (!best) {
    return { group: 'OTHER', action: DEFAULT_ACTIONS.OTHER, confidence: RULES_FALLBACK_CONFIDENCE, quotes: [] }
  }

  const quotes = sentences
    .filter((sentence) => best!.matchedWords.some((word) => new RegExp(word, 'i').test(sentence.toLowerCase())))
    .slice(0, MAX_QUOTES)
    .map((sentence) => truncate(sentence, QUOTE_MAX_LENGTH))

  // Уверенность растёт с числом разных совпавших признаков, не выше потолка правил:
  // без модели нельзя быть «уверенным» — только «похоже на».
  const confidence = Math.min(RULES_MAX_CONFIDENCE, RULES_FALLBACK_CONFIDENCE + best.score * 0.1)

  return { group: best.group, action: DEFAULT_ACTIONS[best.group], confidence, quotes }
}

/** Превью письма для списка — обрезка по границе слова, если можно. */
export function bodyPreview(text: string, maxLength: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= maxLength) return trimmed
  const cut = trimmed.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut}…`
}
