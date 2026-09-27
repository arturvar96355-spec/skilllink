import type { ChannelStatusDto, IntegrationsStatusDto } from '@/shared/contracts'

/**
 * Статус каждого канала и интеграции простыми словами (решение 212).
 *
 * Эксперт видел «Требует настройки», «Подключена (демо)» и переменные вроде
 * LMS_ENABLED — и не мог за три секунды понять, что на стенде работает.
 * Здесь один словарь из четырёх состояний на все каналы: что есть — «Подключено»,
 * что написано, но ждёт ключа — «Готово, не подключено», что показывает
 * учебные данные — «Демо-данные», что выключено — «Выключено». Под каждым —
 * одна строка, что это за канал и что нужно для включения.
 *
 * Без React — проверяется тестом.
 * TODO: PM DECISION — формулировки статусов согласовать с Артуром до вливания
 * (пометка перенесена из прежнего `integrationStatus` в settings/page.tsx).
 */
export type ChannelState = 'connected' | 'ready' | 'demo' | 'off'

export const CHANNEL_STATE_LABELS: Record<ChannelState, string> = {
  connected: 'Подключено',
  ready: 'Готово, не подключено',
  demo: 'Демо-данные',
  off: 'Выключено',
}

export const CHANNEL_STATE_TONE: Record<ChannelState, 'success' | 'warning' | 'mock' | 'neutral'> = {
  connected: 'success',
  ready: 'warning',
  demo: 'mock',
  off: 'neutral',
}

export interface ChannelRow {
  key: string
  title: string
  /** Что это и что нужно для включения — одна строка. */
  caption: string
  state: ChannelState
}

const MESSENGER_WHAT: Record<string, string> = {
  telegram: 'Сводка «что горит» и оповещения сотрудникам в Telegram',
  max: 'Те же оповещения в мессенджере MAX',
  vk: 'Те же оповещения в сообщениях VK',
}

function messengerRow(channel: ChannelStatusDto): ChannelRow {
  const what = MESSENGER_WHAT[channel.id] ?? 'Оповещения сотрудникам'
  return channel.configured
    ? { key: channel.id, title: channel.title, caption: `${what}. Работает на этом стенде.`, state: 'connected' }
    : {
        key: channel.id,
        title: channel.title,
        caption: `${what}. Код готов — нужен токен бота, который вносит администратор.`,
        state: 'ready',
      }
}

function aiRow(ai: IntegrationsStatusDto['aiAssist']): ChannelRow {
  const title = ai.provider === 'off' ? 'ИИ-помощник' : `ИИ-помощник (${ai.name}${ai.model ? `, ${ai.model}` : ''})`
  if (ai.provider === 'off') {
    return {
      key: 'ai',
      title,
      caption: 'Черновики писем и сводок. Сейчас их пишет шаблон по тем же фактам — работа не останавливается.',
      state: 'off',
    }
  }
  if (!ai.ready) {
    return {
      key: 'ai',
      title,
      caption: 'Черновики писем и сводок. Код готов — нужен ключ модели; пока пишет шаблон.',
      state: 'ready',
    }
  }
  return { key: 'ai', title, caption: 'Пишет черновики писем вузам и сводки по связкам.', state: 'connected' }
}

const SOURCE_WHAT: Record<string, { title: string; what: string }> = {
  'market-data': { title: 'Рыночные данные', what: 'Спрос на навыки для дефицитов и рейтинга программ' },
  lms: { title: 'LMS', what: 'Выгрузка слушателей в систему обучения' },
  site: { title: 'Сайт ИТ-Школы', what: 'Заявки на курсы с сайта' },
}

function sourceRow(item: IntegrationsStatusDto['integrations'][number]): ChannelRow {
  const known = SOURCE_WHAT[item.key]
  const title = known?.title ?? item.name
  const what = known?.what ?? item.name
  if (!item.enabled) {
    return { key: item.key, title, caption: `${what}. Код готов, на стенде выключено.`, state: 'off' }
  }
  if (!item.configured) {
    return { key: item.key, title, caption: `${what}. Код готов — нужен адрес и ключ источника.`, state: 'ready' }
  }
  if (item.isMock) {
    return { key: item.key, title, caption: `${what}. Сейчас — учебный набор, помечен как демо.`, state: 'demo' }
  }
  return { key: item.key, title, caption: `${what}. Данные приходят из источника.`, state: 'connected' }
}

/**
 * Все каналы одним списком: мессенджеры, ИИ-помощник, источники данных.
 * Каналы мессенджеров без ответа сервера (`channels === null`) не выдумываются.
 */
export function channelRows(
  integrations: IntegrationsStatusDto,
  channels: readonly ChannelStatusDto[] | null,
): ChannelRow[] {
  return [
    ...(channels ?? []).map(messengerRow),
    aiRow(integrations.aiAssist),
    ...integrations.integrations.map(sourceRow),
  ]
}
