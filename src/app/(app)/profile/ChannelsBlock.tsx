'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { ChannelConnectDto, ChannelId, ChannelStatusDto } from '@/shared/contracts'
import {
  Badge,
  Button,
  Skeleton,
  apiDelete,
  apiPost,
  apiPut,
  formatDateTime,
  useMutation,
  useResource,
  useToast,
} from '@/ui'
import styles from './profile.module.css'

/** Как часто спрашивать, нажал ли человек «Старт» в канале. */
const POLL_MS = 4000

/**
 * Блок «Каналы уведомлений» личного кабинета (решение 144): Telegram, MAX и VK
 * рядом, один интерфейс на все три. Не заменяет Telegram-путь (`/api/me/telegram`,
 * решение 102) — использует общий слой каналов сверху (`/api/me/channels`).
 *
 * Настоящих токенов MAX/VK на этом хакатоне нет и не будет: оба канала честно
 * показывают «Не настроено администратором», как Telegram без токена, — ничего
 * не падает и не требует ключей, чтобы страница работала.
 */
export function ChannelsBlock() {
  const toast = useToast()
  const status = useResource<ChannelStatusDto[]>('/api/me/channels')
  const [links, setLinks] = useState<Record<ChannelId, ChannelConnectDto | null>>({ telegram: null, max: null, vk: null })
  const [override, setOverride] = useState<ChannelStatusDto[] | null>(null)

  const connect = useMutation(async (id: ChannelId) => (await apiPost<ChannelConnectDto>(`/api/me/channels/${id}/connect`)).data)
  const disconnect = useMutation(async (id: ChannelId) => (await apiDelete<ChannelStatusDto[]>(`/api/me/channels/${id}`)).data)
  const setPrimary = useMutation(async (id: ChannelId) => (await apiPut<ChannelStatusDto[]>('/api/me/channels', { primary: id })).data)

  const data = override ?? status.data
  const { reload } = status
  const pendingLink = (Object.entries(links) as [ChannelId, ChannelConnectDto | null][]).find(([, link]) => link !== null)

  useEffect(() => {
    if (!pendingLink) return
    const [id, link] = pendingLink
    if (!link) return
    const linked = data?.find((row) => row.id === id)?.linked
    if (linked) return
    const timer = setInterval(() => {
      if (Date.now() > Date.parse(link.expiresAt)) {
        setLinks((prev) => ({ ...prev, [id]: null }))
        return
      }
      setOverride(null)
      reload()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [pendingLink, data, reload])

  useEffect(() => {
    if (!pendingLink) return
    const [id] = pendingLink
    if (data?.find((row) => row.id === id)?.linked) {
      setLinks((prev) => ({ ...prev, [id]: null }))
      toast.success('Канал подключён: сводка будет приходить туда')
    }
  }, [pendingLink, data, toast])

  async function onConnect(id: ChannelId) {
    const result = await connect.run(id)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setLinks((prev) => ({ ...prev, [id]: result.data }))
    window.open(result.data.url, '_blank', 'noopener,noreferrer')
  }

  async function onDisconnect(id: ChannelId) {
    const result = await disconnect.run(id)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setOverride(result.data)
    toast.success('Канал отключён')
  }

  async function onSetPrimary(id: ChannelId) {
    const result = await setPrimary.run(id)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setOverride(result.data)
  }

  if (!data) {
    return (
      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>Каналы уведомлений</span>
          <span className={styles.rowCaption}>{status.error ? 'Не удалось узнать состояние. Обновите страницу.' : 'Загрузка…'}</span>
        </div>
        <div className={styles.rowSide}>{status.isLoading ? <Skeleton width="120px" /> : null}</div>
      </div>
    )
  }

  const linkedCount = data.filter((row) => row.linked).length

  return (
    <>
      {data.map((row) => {
        const link = links[row.id]
        let caption: string
        let side: ReactNode = null

        if (!row.configured) {
          caption = 'Не настроено администратором.'
        } else if (row.linked) {
          const who = row.username ? ` как @${row.username}` : ''
          const since = row.linkedAt ? ` · с ${formatDateTime(row.linkedAt)}` : ''
          caption = `Подключено${who}${since}.`
          side = (
            <div className={styles.rowActions}>
              {row.primary && linkedCount > 1 ? <Badge tone="info">Основной</Badge> : null}
              {!row.primary && linkedCount > 1 ? (
                <Button variant="secondary" onClick={() => onSetPrimary(row.id)} isLoading={setPrimary.isPending}>
                  Сделать основным
                </Button>
              ) : null}
              {link ? (
                <Button variant="secondary" href={link.url} external>
                  Открыть ссылку
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => onConnect(row.id)} isLoading={connect.isPending}>
                  Перепривязать
                </Button>
              )}
              <Button variant="secondary" onClick={() => onDisconnect(row.id)} isLoading={disconnect.isPending}>
                Отключить
              </Button>
            </div>
          )
        } else {
          caption = link
            ? 'Откройте ссылку и напишите боту — она действует 15 минут и срабатывает один раз.'
            : 'Сюда будет приходить сводка «что горит у меня», если сделать канал основным.'
          side = link ? (
            <Button variant="secondary" href={link.url} external>
              Открыть
            </Button>
          ) : (
            <Button variant="primary" onClick={() => onConnect(row.id)} isLoading={connect.isPending}>
              Подключить
            </Button>
          )
        }

        return (
          <div className={styles.row} key={row.id}>
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>{row.title}</span>
              <span className={styles.rowCaption}>{caption}</span>
            </div>
            <div className={styles.rowSide}>{side}</div>
          </div>
        )
      })}
    </>
  )
}
