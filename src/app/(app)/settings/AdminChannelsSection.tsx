'use client'

import type { AdminChannelStatusDto, AdminChannelTestDto } from '@/shared/contracts'
import { Badge, Button, ErrorState, apiPost, useMutation, useResource, useToast } from '@/ui'
import { Row, RowsSkeleton } from './SettingsRow'
import styles from './settings.module.css'

/**
 * Статус каналов уведомлений для администратора (решение 144): «Настройки →
 * Интеграции». Строки — MAX и VK — настроен ли каждый и сколько сотрудников
 * привязано; «Проверить» шлёт пробное сообщение в чат самого администратора
 * (сначала он должен подключить канал себе в личном кабинете).
 *
 * Telegram сюда не выводится — у него свой подробный блок `TelegramBotAdminSection`
 * (решение 142, токен/режим/вебхук) прямо над этим; повторять его статус и кнопку
 * «Проверить» здесь было бы дублированием одного и того же действия.
 */
export function AdminChannelsSection() {
  const toast = useToast()
  const channels = useResource<AdminChannelStatusDto[]>('/api/admin/channels')
  const test = useMutation(
    async (id: string) => (await apiPost<AdminChannelTestDto>(`/api/admin/channels/${id}/test`)).data,
  )

  if (channels.isLoading) return <RowsSkeleton count={2} />
  if (channels.error) return <ErrorState error={channels.error} onRetry={channels.reload} />
  if (!channels.data) return null
  const rows = channels.data.filter((channel) => channel.id !== 'telegram')

  async function onTest(id: string) {
    const result = await test.run(id)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    if (result.data.ok) toast.success('Сообщение отправлено — проверьте свой чат')
    else toast.error(result.data.reason ?? 'Не отправлено')
  }

  return (
    <>
      {rows.map((channel) => (
        <Row
          key={channel.id}
          title={channel.title}
          caption={
            channel.configured
              ? `Привязано сотрудников: ${channel.linkedCount}`
              : 'Не настроено — нет токена в переменных окружения (docs/SETUP.md)'
          }
        >
          <div className={styles.rowActions}>
            <Badge tone={channel.configured ? 'success' : 'neutral'} withDot>
              {channel.configured ? 'Настроено' : 'Не настроено'}
            </Badge>
            <Button variant="secondary" onClick={() => onTest(channel.id)} isLoading={test.isPending} disabled={!channel.configured}>
              Проверить
            </Button>
          </div>
        </Row>
      ))}
    </>
  )
}
