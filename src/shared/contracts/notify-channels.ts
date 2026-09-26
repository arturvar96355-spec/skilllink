/**
 * Каналы уведомлений: Telegram, MAX, VK (решение 144). Блок «Каналы уведомлений»
 * в личном кабинете и статус в «Настройки → Интеграции».
 */

export type ChannelId = 'telegram' | 'max' | 'vk'

/** Элемент GET/PUT /api/me/channels: одна строка блока. */
export interface ChannelStatusDto {
  id: ChannelId
  title: string
  /** Настроен администратором (есть токен). false — «Не настроено администратором», кнопок нет. */
  configured: boolean
  linked: boolean
  username: string | null
  linkedAt: string | null
  /** Основной канал: сюда уходит сводка и оповещения, если настроено и привязано несколько. */
  primary: boolean
}

/** PUT /api/me/channels: тело запроса — какой канал сделать основным (null — снова автоматически). */
export interface SetPrimaryChannelDto {
  primary: ChannelId | null
}

/** POST /api/me/channels/{id}/connect: ссылка на канал с одноразовым кодом привязки. */
export interface ChannelConnectDto {
  url: string
  expiresAt: string
}

/** GET /api/admin/channels: статус канала для администратора. */
export interface AdminChannelStatusDto {
  id: ChannelId
  title: string
  configured: boolean
  linkedCount: number
}

/** POST /api/admin/channels/{id}/test: пробное сообщение администратору в его чат. */
export interface AdminChannelTestDto {
  ok: boolean
  reason?: string
}
