/**
 * Общий слой каналов уведомлений: Telegram, MAX, VK (решение 144).
 *
 * Один интерфейс на все три канала: сводка «что горит у меня» (решение 120) и
 * оповещения владельцу (решение 118) вызывают `sendToUser`/`sendToOwners`, не зная,
 * какой канал в итоге доставит сообщение. Добавить канал — значит добавить адаптер
 * и завести его в реестре, не трогая ни сводку, ни оповещения.
 */

export type ChannelId = 'telegram' | 'max' | 'vk'
/** Каналы со своей общей моделью привязки (notification_channel_links) — все, кроме Telegram. */
export type AltChannelId = ChannelId

/** Порядок — приоритет по умолчанию (решение 144): Telegram первым, он работает дольше всех. */
export const CHANNEL_IDS: readonly ChannelId[] = ['telegram', 'max', 'vk']

export function isChannelId(value: string): value is ChannelId {
  return (CHANNEL_IDS as readonly string[]).includes(value)
}

export type ChannelSendResult =
  | { ok: true }
  | {
      ok: false
      /** `disabled` — канал не настроен; `blocked` — получатель недоступен; `failed` — прочее. */
      reason: 'disabled' | 'blocked' | 'failed'
    }

export interface ChannelSendOptions {
  /** Не ждать долго: сводка не должна повиснуть на одном недоступном канале. */
  timeoutMs?: number
  /**
   * Кому уходит сообщение (id пользователя SkillLink). Нужен адаптеру, который
   * подписывает кнопку «Принял» (решение 200): подпись привязана к чату и к человеку.
   * Нет — кнопок с обратным вызовом нет, остаются только ссылки.
   */
  recipientUserId?: string
}

/** Объект, который можно «принять в работу» кнопкой в сообщении (решение 200). */
export type AcceptTarget = { type: 'stage'; id: string } | { type: 'letter'; id: string }

/**
 * Действие-кнопка под сообщением (решение 200) — описание, а не разметка конкретного
 * канала: `open` — ссылка на страницу SkillLink, `accept` — «Принял, беру в работу».
 * Как нарисовать и подписать, решает адаптер; канал без кнопок их пропускает
 * и отправляет только `text` (ссылки на страницы в тексте уже есть).
 */
export type MessageAction =
  | { kind: 'open'; text: string; url: string }
  | { kind: 'accept'; text: string; target: AcceptTarget }

/** Подписи кнопок, общие для каналов (решение 200). */
export const ACTION_TEXTS = {
  accept: '✓ Принял, беру в работу',
  openLetter: 'Открыть письмо',
  // Уведомление о назначении ответственным (решение 205).
  openCooperation: 'Открыть связку',
  openStage: 'Открыть этап',
  openUniversity: 'Открыть вуз',
  // Поручение сотруднику (решение 207).
  openAssignment: 'Открыть поручение',
} as const

/** Сообщение канала: текст и, если есть, строки кнопок. */
export interface ChannelMessage {
  text: string
  actions?: MessageAction[][]
}

/** Строка — это сообщение без кнопок: так прежние вызовы `send(chat, 'текст')` не меняются. */
export function toChannelMessage(message: string | ChannelMessage): ChannelMessage {
  return typeof message === 'string' ? { text: message } : message
}

/** Разобранное входящее обновление канала — то общее, что нужно сервису привязки и командам. */
export interface ParsedInbound {
  /** Идентификатор чата/собеседника на стороне канала — по нему шлём ответ и хранится привязка. */
  chatRef: string
  /** Код одноразовой привязки, если он был в этом обновлении (диплинк/ref). */
  code?: string
  /** Ник собеседника, если канал его прислал. */
  username?: string | null
  /** Распознанная команда пользователя. */
  command?: 'today' | 'stop' | 'unknown'
  /** Само сообщение проигнорировано (служебное событие без текста и без кода). */
  ignored?: boolean
}

/**
 * Адаптер канала. `configured()` — можно ли вообще что-то отправить (есть токен);
 * это не то же самое, что «у пользователя есть привязка» — тем занимается сервис.
 */
export interface ChannelAdapter {
  readonly id: ChannelId
  configured(): boolean
  /**
   * Отправить сообщение. Кнопки (`actions`) рисует только адаптер, который их умеет
   * (Telegram, решение 200); остальные отправляют `text` и кнопки молча пропускают.
   */
  send(chatRef: string, message: string | ChannelMessage, opts?: ChannelSendOptions): Promise<ChannelSendResult>
  /** Ссылка/диплинк «Подключить» с одноразовым кодом привязки. null — канал не настроен. */
  linkUrl(code: string): string | null
  /** Разобрать входящее обновление вебхука/long polling в общий вид. */
  parseInbound(update: unknown): ParsedInbound | null
}
