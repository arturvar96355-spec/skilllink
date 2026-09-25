import type { AiAssistProviderKind } from '../config'

/**
 * Языковая модель для ИИ-помощника (решение 84).
 *
 * Модель здесь — не часть бизнес-логики: она ничего не решает и данных не меняет.
 * На вход она получает уже посчитанные правилами факты, на выходе — черновик текста
 * для человека. Если модели нет или она подвела, помощник пишет тот же текст
 * шаблоном — поэтому интерфейс провайдера нарочно минимальный: текст на вход,
 * текст на выход.
 */
export interface LlmRequest {
  /** Инструкция модели: роль, формат, запреты. */
  system: string
  /** Факты и задание. Персональных данных здесь быть не должно. */
  user: string
}

export interface LlmCompletion {
  text: string
  /** Какая модель ответила — показывается рядом с черновиком. */
  model: string
}

export interface LlmProviderInfo {
  kind: AiAssistProviderKind
  /** Человекочитаемое имя: YandexGPT, GigaChat. */
  name: string
  /** Настроен ли провайдер: есть ключ, каталог, сертификат. */
  ready: boolean
  /** Чего не хватает, если не готов. */
  reason: string | null
  model: string | null
}

export interface LlmProvider {
  info(): LlmProviderInfo
  generate(request: LlmRequest): Promise<LlmCompletion>
}

/**
 * Почему модель не дала текста.
 *
 * - `timeout` — не уложилась в AI_ASSIST_TIMEOUT_MS;
 * - `error` — сеть, HTTP-ошибка, ответ неожиданного формата;
 * - `empty` — ответила пустотой или отказом фильтра содержания.
 */
export type LlmFailureKind = 'timeout' | 'error' | 'empty'

export class LlmError extends Error {
  constructor(
    readonly kind: LlmFailureKind,
    message: string,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

/**
 * Вид сбоя по любой ошибке провайдера.
 *
 * YandexGPT ходит через общий клиент интеграций: он превращает обрыв по таймауту
 * в ошибку интеграции с текстом «…aborted», и отличить таймаут можно только по нему.
 */
export function llmFailureKind(error: unknown): LlmFailureKind {
  if (error instanceof LlmError) return error.kind
  const message = error instanceof Error ? error.message : String(error)
  return /abort|timeout|тайм-?аут/i.test(message) ? 'timeout' : 'error'
}
