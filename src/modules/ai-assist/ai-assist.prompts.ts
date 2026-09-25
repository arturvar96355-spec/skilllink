import type { AiDraftKind } from '@/shared/contracts/ai-assist'
import { redactDeep, type Redact } from './ai-assist.privacy'
import {
  countNumberedItems,
  letterLines,
  letterTemplate,
  summaryLines,
  summaryTemplate,
  todayLines,
  todayTemplate,
  type LetterFacts,
  type SummaryFacts,
  type TodayItem,
} from './ai-assist.rules'

/**
 * Промпты ИИ-помощника — по одной функции сборки на каждый вид черновика.
 *
 * Каждая функция сама пропускает факты через `redact` — так персональные данные
 * не попадают в модель, даже если вызывающий код забыл их вычистить. Шаблон
 * без модели собирается из тех же очищенных фактов, поэтому сводка от модели
 * и шаблонная говорят об одном и том же.
 */
export interface AiPrompt {
  kind: AiDraftKind
  system: string
  user: string
  /** Строки фактов: ушли в модель, показываются под черновиком. */
  facts: string[]
  /** Тот же черновик без модели. */
  template: string
  /** Проверка ответа модели сверх непустоты. `false` — ответ не годится, нужен шаблон. */
  accepts: (text: string) => boolean
}

/** Общие запреты: модель пересказывает, а не сочиняет. */
const COMMON_RULES = [
  'Ты помогаешь сотруднику ИТ-Школы РТК, которая работает с вузами.',
  'Пиши по-русски, деловым языком, коротко и без канцелярита.',
  'Пиши только по фактам из сообщения. Не придумывай даты, сроки, числа, имена, должности, телефоны, адреса и названия, которых нет в фактах.',
  'Не добавляй советов и выводов, которых нет в фактах.',
  'Не используй разметку Markdown: без звёздочек, решёток и таблиц.',
].join('\n')

function factsBlock(lines: readonly string[]): string {
  return lines.map((line) => `- ${line}`).join('\n')
}

const anyText = (text: string) => text.trim().length > 0

// ─────────────────────────── Сводка по связке ───────────────────────────────

export function buildSummaryPrompt(facts: SummaryFacts, redact: Redact): AiPrompt {
  const safe = redactDeep(facts, redact)
  const lines = summaryLines(safe)
  return {
    kind: 'cooperation-summary',
    system: [
      COMMON_RULES,
      'Составь сводку по связке «вуз — программа — IT-продукт» в 3–5 предложениях:',
      'где связка сейчас, что мешает, что сделать дальше.',
      'Что сделать дальше — бери только из действий открытых рекомендаций и проблемных этапов.',
      'Одним абзацем, без списков и заголовков.',
    ].join('\n'),
    user: `Факты о связке:\n${factsBlock(lines)}\n\nСоставь сводку.`,
    facts: lines,
    template: summaryTemplate(safe),
    accepts: anyText,
  }
}

// ─────────────────────── Письмо вузу по рекомендации ─────────────────────────

export function buildLetterPrompt(facts: LetterFacts, redact: Redact): AiPrompt {
  const safe = redactDeep(facts, redact)
  const lines = letterLines(safe)
  return {
    kind: 'recommendation-letter',
    system: [
      COMMON_RULES,
      'Составь вежливое деловое письмо от лица ИТ-Школы РТК представителю вуза.',
      'Первая строка — «Тема: …». Обращение — «Уважаемые коллеги!». Подпись — «С уважением,» и на следующей строке «ИТ-Школа РТК».',
      'Не указывай имён, должностей и контактов — ни получателя, ни отправителя.',
      'Сроки называй только те, что есть в фактах. Если срока нет — не называй никакой даты.',
      'Не упоминай внутренние приоритеты, рекомендации, правила и систему, в которой работает сотрудник.',
      'Письмо — не длиннее 150 слов.',
    ].join('\n'),
    user: `Факты для письма:\n${factsBlock(lines)}\n\nСоставь письмо.`,
    facts: lines,
    template: letterTemplate(safe),
    // Без подписи от ИТ-Школы это не письмо, а что-то другое.
    accepts: (text) => anyText(text) && /ИТ[\s\-‑–]?Школ/i.test(text),
  }
}

// ─────────────────────────── «Что сделать сегодня» ───────────────────────────

export function buildTodayPrompt(items: readonly TodayItem[], redact: Redact): AiPrompt {
  const safe = redactDeep([...items], redact)
  const lines = todayLines(safe)
  return {
    kind: 'today',
    system: [
      COMMON_RULES,
      'Перед тобой дела сотрудника на сегодня. Порядок уже задан правилами по важности — не меняй его.',
      `Для каждого пункта напиши две строки: «N. <что сделать — одно короткое предложение с глаголом в повелительном наклонении>, <где>» и «Почему: <одна строка>».`,
      `Пунктов ровно ${safe.length}. Не добавляй и не убирай пункты, не пиши вступлений и выводов.`,
    ].join('\n'),
    user: `Дела по порядку:\n${lines.join('\n')}\n\nПерепиши список.`,
    facts: lines,
    template: todayTemplate(safe),
    // Модель могла потерять или добавить пункт — тогда её порядок уже не порядок правил.
    accepts: (text) => anyText(text) && countNumberedItems(text) === safe.length,
  }
}
