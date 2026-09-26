import { z } from '@/shared/zod'
import type { AiDraftKind } from '@/shared/contracts/ai-assist'
import { INBOUND_LETTER_GROUPS, type InboundLetterGroup } from '@/shared/contracts/enums'
import { INBOUND_LETTER_GROUP_LABELS } from '@/shared/contracts/labels'
import { MAX_QUOTES, QUOTE_MAX_LENGTH } from '@/shared/config/inbound-letters.config'
import type { AiPrompt } from '@/modules/ai-assist/ai-assist.prompts'
import { redactDeep, type Redact } from '@/modules/ai-assist/ai-assist.privacy'
import type { RuleClassification } from './inbound-letters.rules'

/**
 * Промпты письма вуза: разбор (JSON) и черновик ответа (текст) — решение 170.
 *
 * Тот же принцип, что у ИИ-помощника (решение 90): модель получает уже очищенные
 * от персональных данных факты и либо формулирует, либо отвечает по строгой схеме;
 * шаблон/правила — из тех же очищенных фактов, так что ответ модели и запасной
 * путь говорят об одном.
 */

const GROUPS_DESCRIPTION = INBOUND_LETTER_GROUPS.map((group) => `${group} — «${INBOUND_LETTER_GROUP_LABELS[group]}»`).join('; ')

// ─────────────────────────── Разбор письма (JSON) ────────────────────────────

export interface AnalysisExample {
  text: string
  group: InboundLetterGroup
  action: string
}

export interface AnalysisFacts {
  subject: string
  body: string
  universityName: string | null
  stageInfo: string | null
  examples: readonly AnalysisExample[]
}

/** Схема ответа модели — строго один объект, без пояснений вокруг. */
export const modelAnalysisSchema = z.object({
  group: z.enum(INBOUND_LETTER_GROUPS),
  action: z.string().trim().min(1).max(300),
  confidence: z.number().min(0).max(1),
  quotes: z.array(z.string().trim().min(1).max(QUOTE_MAX_LENGTH)).max(MAX_QUOTES),
})

export type ModelAnalysis = z.infer<typeof modelAnalysisSchema>

/** JSON модели после очистки (`compose()` уже прогнал через `cleanModelText`+`redact`). */
export function tryParseAnalysis(text: string): ModelAnalysis | null {
  // Модель иногда оборачивает JSON текстом вокруг — берём первую фигурную скобку до последней.
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
    const result = modelAnalysisSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

function exampleLines(examples: readonly AnalysisExample[]): string[] {
  return examples.map(
    (example, index) =>
      `${index + 1}. Письмо: «${example.text}» → группа ${example.group} (${INBOUND_LETTER_GROUP_LABELS[example.group]}), действие: «${example.action}».`,
  )
}

export function buildAnalysisPrompt(facts: AnalysisFacts, fallback: RuleClassification, redact: Redact): AiPrompt {
  const safe = redactDeep(facts, redact)
  const lines = [
    `Тема письма: ${safe.subject || '(без темы)'}`,
    `Вуз: ${safe.universityName ?? 'не определён кодом'}`,
    `Текущий этап связки: ${safe.stageInfo ?? 'нет данных'}`,
    `Текст письма: ${safe.body}`,
    ...exampleLines(safe.examples),
  ]

  const template = JSON.stringify({
    group: fallback.group,
    action: fallback.action,
    confidence: fallback.confidence,
    quotes: fallback.quotes,
  })

  return {
    kind: 'inbound-letter-analysis' as AiDraftKind,
    system: [
      'Ты помогаешь сотруднику ИТ-Школы РТК разбирать письма вузов-партнёров.',
      `Отнеси письмо ровно к одной группе из списка: ${GROUPS_DESCRIPTION}.`,
      'Определи короткое действие ответственному сотруднику по-русски (не длиннее одного предложения).',
      'Оцени уверенность разбора числом от 0 до 1.',
      `Приведи до ${MAX_QUOTES} коротких цитат из письма, на которые опирается разбор.`,
      'Ниже — примеры прошлых писем с уже проверенным сотрудником разбором: ориентируйся на них при сомнении.',
      'Ответь СТРОГО одним JSON-объектом без пояснений, без markdown, по схеме:',
      '{"group": "ОДНА_ИЗ_ГРУПП", "action": "текст", "confidence": 0.0, "quotes": ["..."]}',
      'Ничего, кроме этого JSON-объекта, не пиши.',
    ].join('\n'),
    user: lines.join('\n'),
    facts: lines,
    template,
    accepts: (text) => tryParseAnalysis(text) !== null,
  }
}

// ─────────────────────────── Черновик ответа вузу ────────────────────────────

export interface ReplyDraftFacts {
  universityName: string | null
  subject: string
  group: InboundLetterGroup
  action: string
}

function replyTemplate(facts: ReplyDraftFacts): string {
  return [
    'Уважаемые коллеги!',
    '',
    'Благодарим за письмо. Мы получили обращение и передали его ответственному сотруднику ИТ-Школы РТК.',
    `В ближайшее время вернёмся с ответом по существу: ${facts.action.toLowerCase()}.`,
    '',
    'С уважением,',
    'ИТ-Школа РТК',
  ].join('\n')
}

export function buildReplyDraftPrompt(facts: ReplyDraftFacts, redact: Redact): AiPrompt {
  const safe = redactDeep(facts, redact)
  const lines = [
    `Вуз: ${safe.universityName ?? 'не указан'}`,
    `Тема письма вуза: ${safe.subject || '(без темы)'}`,
    `Группа обращения: ${INBOUND_LETTER_GROUP_LABELS[safe.group]}`,
    `Что мы планируем сделать: ${safe.action}`,
  ]

  return {
    kind: 'inbound-letter-reply' as AiDraftKind,
    system: [
      'Ты помогаешь сотруднику ИТ-Школы РТК составить черновик ответа вузу-партнёру.',
      'Пиши по-русски, деловым языком, коротко, без канцелярита.',
      'Обращение — «Уважаемые коллеги!». Подпись — «С уважением,» и на следующей строке «ИТ-Школа РТК».',
      'Пиши только по фактам ниже — не придумывай сроки, числа, имена и договорённости, которых там нет.',
      'Не указывай имён, должностей и контактов — ни отправителя, ни получателя.',
      'Письмо — не длиннее 120 слов. Без разметки Markdown.',
    ].join('\n'),
    user: `Факты для письма:\n${lines.map((line) => `- ${line}`).join('\n')}\n\nСоставь письмо.`,
    facts: lines,
    template: replyTemplate(safe),
    accepts: (text) => text.trim().length > 0 && /ИТ[\s\-‑–]?Школ/i.test(text),
  }
}
