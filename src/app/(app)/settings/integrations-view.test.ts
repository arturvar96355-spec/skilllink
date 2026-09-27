import { describe, expect, it } from 'vitest'
import type { ChannelStatusDto, IntegrationsStatusDto } from '@/shared/contracts'
import { CHANNEL_STATE_LABELS, channelRows } from './integrations-view'

/**
 * Каналы простыми словами (решение 212): на стенде Telegram и YandexGPT
 * подключены, VK и MAX — код готов, токена нет, рыночные данные — демо,
 * LMS и сайт — выключены. Так и должно читаться за три секунды.
 */
function channel(id: ChannelStatusDto['id'], title: string, configured: boolean): ChannelStatusDto {
  return { id, title, configured, linked: false, username: null, linkedAt: null, primary: false }
}

const standLike: IntegrationsStatusDto = {
  marketDataProvider: 'mock',
  integrations: [
    { key: 'market-data', name: 'Демонстрационный набор вакансий', enabled: true, configured: true, reason: null, isMock: true },
    { key: 'lms', name: 'LMS', enabled: false, configured: false, reason: 'LMS_ENABLED=false', isMock: true },
    { key: 'site', name: 'Сайт', enabled: false, configured: false, reason: 'SITE_ENABLED=false', isMock: true },
  ],
  aiAssist: { provider: 'yandexgpt', name: 'YandexGPT', ready: true, model: 'yandexgpt-lite', reason: null },
  checkedAt: '2026-09-27T00:00:00.000Z',
}

describe('статусы каналов словами', () => {
  it('как на стенде: подключено, готово без токена, демо, выключено', () => {
    const rows = channelRows(standLike, [
      channel('telegram', 'Telegram', true),
      channel('max', 'MAX', false),
      channel('vk', 'VK', false),
    ])
    const byKey = Object.fromEntries(rows.map((row) => [row.key, CHANNEL_STATE_LABELS[row.state]]))
    expect(byKey).toEqual({
      telegram: 'Подключено',
      max: 'Готово, не подключено',
      vk: 'Готово, не подключено',
      ai: 'Подключено',
      'market-data': 'Демо-данные',
      lms: 'Выключено',
      site: 'Выключено',
    })
    expect(rows.find((row) => row.key === 'vk')!.caption).toContain('нужен токен бота')
    expect(rows.find((row) => row.key === 'ai')!.title).toBe('ИИ-помощник (YandexGPT, yandexgpt-lite)')
  })

  it('в подписях нет переменных окружения — только слова', () => {
    const rows = channelRows(standLike, [channel('telegram', 'Telegram', false)])
    for (const row of rows) expect(row.caption).not.toMatch(/[A-Z_]{4,}=/)
  })

  it('ИИ выключен — пишет шаблон, работа не останавливается', () => {
    const rows = channelRows({ ...standLike, aiAssist: { provider: 'off', name: 'ИИ-помощник выключен', ready: false, model: null, reason: null } }, null)
    const ai = rows.find((row) => row.key === 'ai')!
    expect(ai.state).toBe('off')
    expect(ai.caption).toContain('шаблон')
  })

  it('мессенджеры без ответа сервера не выдумываются', () => {
    expect(channelRows(standLike, null).map((row) => row.key)).toEqual(['ai', 'market-data', 'lms', 'site'])
  })
})
