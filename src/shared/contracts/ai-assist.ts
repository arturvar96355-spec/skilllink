/**
 * ИИ-помощник (решение 90): черновики текста по фактам, которые посчитали правила.
 *
 * Модель ничего не решает: что рекомендовать и в каком порядке, задают правила
 * рекомендаций. Модель только переписывает готовые факты читаемым текстом.
 * Если модели нет или она подвела, тот же текст собирается шаблоном — и интерфейс
 * обязан честно показать, кто его написал.
 */

/**
 * Что за черновик. Последние два — письма вузов (решение 170): `inbound-letter-analysis`
 * не текст для показа, а JSON-ответ разбора (см. `inbound-letters.prompts.ts`) —
 * тот же конвейер `compose()` (кэш, лимит, запасной путь), только результат — данные,
 * а не готовый текст.
 */
export const AI_DRAFT_KINDS = [
  'cooperation-summary',
  'recommendation-letter',
  'today',
  'inbound-letter-analysis',
  'inbound-letter-reply',
] as const
export type AiDraftKind = (typeof AI_DRAFT_KINDS)[number]

/** Кто написал текст: одна из российских моделей или шаблон без модели. */
export const AI_DRAFT_SOURCES = ['yandexgpt', 'gigachat', 'template'] as const
export type AiDraftSource = (typeof AI_DRAFT_SOURCES)[number]

/**
 * Почему текст написан шаблоном, а не моделью.
 *
 * - `disabled` — помощник выключен (`AI_ASSIST_PROVIDER=off`, по умолчанию);
 * - `not-configured` — провайдер выбран, но нет ключа или каталога;
 * - `rate-limited` — исчерпан лимит генераций пользователя на час;
 * - `timeout` — модель не ответила вовремя;
 * - `failed` — модель ответила ошибкой;
 * - `empty` — ответ пустой или отказ фильтра содержания;
 * - `invalid` — ответ не прошёл проверку (например, другое число пунктов);
 * - `no-facts` — формулировать нечего: правила ничего не нашли.
 */
export const AI_FALLBACK_REASONS = [
  'disabled',
  'not-configured',
  'rate-limited',
  'timeout',
  'failed',
  'empty',
  'invalid',
  'no-facts',
] as const
export type AiFallbackReason = (typeof AI_FALLBACK_REASONS)[number]

export interface AiDraftDto {
  kind: AiDraftKind
  /** Сам черновик. Отправлять его без проверки человеком нельзя. */
  text: string
  source: AiDraftSource
  /** Модель, если текст написала модель; null — шаблон. */
  model: string | null
  generatedAt: string
  /**
   * Факты, из которых собран текст, — ровно то, что ушло в модель
   * (или в шаблон). Персональных данных в них нет.
   */
  facts: string[]
  /** Почему шаблон. null — текст написала модель. */
  fallbackReason: AiFallbackReason | null
  /** Ответ модели взят из кэша: те же факты недавно уже формулировались. */
  cached: boolean
}

export const AI_DRAFT_SOURCE_LABELS: Record<AiDraftSource, string> = {
  yandexgpt: 'YandexGPT',
  gigachat: 'GigaChat',
  template: 'Шаблон без ИИ',
}

export const AI_FALLBACK_REASON_LABELS: Record<AiFallbackReason, string> = {
  disabled: 'помощник не подключён',
  'not-configured': 'помощник не настроен — нет ключа доступа',
  'rate-limited': 'исчерпан лимит генераций на час',
  timeout: 'модель не ответила вовремя',
  failed: 'модель ответила ошибкой',
  empty: 'модель не дала текста',
  invalid: 'ответ модели не прошёл проверку',
  'no-facts': 'правила ничего не нашли — формулировать нечего',
}

/**
 * Подпись над черновиком: интерфейс всегда говорит, ИИ это или шаблон.
 * «Черновик ИИ (YandexGPT) — проверьте перед отправкой»,
 * «Шаблон без ИИ: помощник не подключён».
 */
export function aiDraftSourceNote(draft: Pick<AiDraftDto, 'source' | 'fallbackReason'>): string {
  if (draft.source === 'template') {
    const reason = draft.fallbackReason ? AI_FALLBACK_REASON_LABELS[draft.fallbackReason] : null
    return reason ? `Шаблон без ИИ: ${reason}` : 'Шаблон без ИИ'
  }
  return `Черновик ИИ (${AI_DRAFT_SOURCE_LABELS[draft.source]}) — проверьте перед отправкой`
}
