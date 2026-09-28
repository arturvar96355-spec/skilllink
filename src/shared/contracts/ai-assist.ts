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
  // Письмо вузу с предложением IT-продукта по рекомендации продуктов (решение 223).
  'product-offer-letter',
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
  /**
   * Что это за письмо для переделки кнопками «Короче», «Мягче»… (решение 213).
   * Есть только у писем вузу; у сводки и «дел на сегодня» — нет.
   */
  rewriteTarget?: AiRewriteTargetDto | null
}

// ─────────────────────── Переделка черновика письма (решение 213) ───────────

/** Как переделать черновик: кнопки под текстом письма. */
export const AI_REWRITE_STYLES = ['shorter', 'softer', 'firmer', 'formal', 'simpler', 'longer'] as const
export type AiRewriteStyle = (typeof AI_REWRITE_STYLES)[number]

export const AI_REWRITE_STYLE_LABELS: Record<AiRewriteStyle, string> = {
  shorter: 'Короче',
  softer: 'Мягче',
  firmer: 'Настойчивее',
  formal: 'Официальнее',
  simpler: 'Проще',
  longer: 'Подробнее',
}

/** Подсказка к кнопке: что именно сделает модель. */
export const AI_REWRITE_STYLE_HINTS: Record<AiRewriteStyle, string> = {
  shorter: 'Сократить примерно вдвое, оставив суть и просьбу',
  softer: 'Смягчить тон: без давления, с благодарностью',
  firmer: 'Ясно попросить ответ — без грубости и новых сроков',
  formal: 'Официально-деловой стиль письма организации',
  simpler: 'Короткие предложения, без канцелярита',
  longer: 'Раскрыть уже сказанное подробнее — без новых фактов',
}

/**
 * Какое письмо переделывается — от этого зависят права и то, чьи названия
 * не прячутся при маскировке:
 * - `recommendation-letter` — письмо вузу по рекомендации (право WRITE), `id` — рекомендация;
 * - `inbound-letter-reply` — ответ на письмо вуза (право INBOUND_REVIEW), `id` — письмо;
 * - `product-offer-letter` — предложение продукта вузу (решение 223), `id` —
 *   `<программа>:<продукт>` (`productOfferTargetId`): письмо про пару, а не про запись.
 */
export const AI_REWRITE_TARGET_TYPES = ['recommendation-letter', 'inbound-letter-reply', 'product-offer-letter'] as const
export type AiRewriteTargetType = (typeof AI_REWRITE_TARGET_TYPES)[number]

export interface AiRewriteTargetDto {
  type: AiRewriteTargetType
  id: string
}

/** `id` цели переделки письма-предложения: пара «программа × продукт» (решение 223). */
export function productOfferTargetId(programId: string, productId: string): string {
  return `${programId}:${productId}`
}

/** Обратно из `id` цели; null — не пара. */
export function parseProductOfferTargetId(id: string): { programId: string; productId: string } | null {
  const [programId, productId, ...rest] = id.split(':')
  if (!programId || !productId || rest.length > 0) return null
  return { programId, productId }
}

/** Ответ `POST /api/ai/rewrite`. Ответ всегда 200: не вышло — прежний текст и пояснение. */
export interface AiRewriteDto {
  /** Новый вариант; если `rewritten: false` — прежний текст без изменений. */
  text: string
  rewritten: boolean
  style: AiRewriteStyle
  source: AiDraftSource
  model: string | null
  /** Почему текст не переделан. null — переделан моделью. */
  fallbackReason: AiFallbackReason | null
  /**
   * Что сказать человеку: почему не переделано, или что перед отправкой в ИИ
   * из текста скрыты персональные данные. null — сказать нечего.
   */
  notice: string | null
  /** Перед отправкой в модель из текста что-то вырезано маскировкой персональных данных. */
  masked: boolean
  cached: boolean
  generatedAt: string
}

/** Ответ `GET /api/ai/rewrite`: можно ли сейчас переделывать текст моделью. */
export interface AiRewriteStatusDto {
  available: boolean
  /** Почему нельзя — простыми словами; null — можно. */
  reason: string | null
}

// ─────────────────── Инструкция администратора для писем (решение 213) ──────

/** Ответ `GET/PUT/DELETE /api/settings/ai-letter-instruction`. */
export interface AiLetterInstructionDto {
  /** Текст инструкции; пустая строка — действуют только базовые правила. */
  text: string
  /** Инструкции нет — письма пишутся по базовым правилам. */
  isDefault: boolean
  maxLength: number
  updatedAt: string | null
  updatedByName: string | null
  /** Базовые правила писем — действуют всегда, инструкция их не отменяет. Для показа в настройках. */
  baseRules: string[]
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
