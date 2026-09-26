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
  send(chatRef: string, text: string, opts?: ChannelSendOptions): Promise<ChannelSendResult>
  /** Ссылка/диплинк «Подключить» с одноразовым кодом привязки. null — канал не настроен. */
  linkUrl(code: string): string | null
  /** Разобрать входящее обновление вебхука/long polling в общий вид. */
  parseInbound(update: unknown): ParsedInbound | null
}
