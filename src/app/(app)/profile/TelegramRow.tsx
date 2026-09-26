'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { TelegramConnectDto, TelegramStatusDto } from '@/shared/contracts'
import {
  Badge,
  Button,
  Skeleton,
  apiDelete,
  apiPost,
  formatDateTime,
  useMutation,
  useResource,
  useToast,
} from '@/ui'
import styles from './profile.module.css'

/** Как часто спрашивать, нажал ли человек «Старт» в Telegram. */
const POLL_MS = 4000

/**
 * Строка настроек «Уведомления в Telegram» (решение 102, перепривязка — решение 142).
 *
 * «Подключить» и «Перепривязать» просят у сервера одну и ту же ссылку
 * t.me/<бот>?start=<токен> (POST работает и при уже существующей привязке) и
 * открывают её; привязка появляется или переносится, когда человек нажмёт
 * «Старт» в Telegram — в том числе в другом чате. Пока ссылка жива,
 * строка сама переспрашивает состояние — перезагружать страницу не нужно.
 * Перепривязку от обычного подключения отличает `intent`: у обеих один и тот
 * же ответ сервера, но у перепривязки готовность видна по смене `linkedAt`
 * (сам факт «linked» уже был true), а не по появлению привязки.
 * Бот не настроен — «Не настроено администратором», кнопок нет.
 */
export function TelegramRow() {
  const toast = useToast()
  const status = useResource<TelegramStatusDto>('/api/me/telegram')
  const [link, setLink] = useState<TelegramConnectDto | null>(null)
  const [intent, setIntent] = useState<'connect' | 'relink' | null>(null)
  const [relinkFromLinkedAt, setRelinkFromLinkedAt] = useState<string | null>(null)
  const [override, setOverride] = useState<TelegramStatusDto | null>(null)

  const connect = useMutation(async () => (await apiPost<TelegramConnectDto>('/api/me/telegram')).data)
  const disconnect = useMutation(async () => (await apiDelete<TelegramStatusDto>('/api/me/telegram')).data)

  const data = override ?? status.data
  const { reload } = status
  const relinkDone = intent === 'relink' && data?.linked && data.linkedAt !== relinkFromLinkedAt
  const connectDone = intent === 'connect' && data?.linked

  useEffect(() => {
    if (!link || connectDone || relinkDone) return
    const timer = setInterval(() => {
      if (Date.now() > Date.parse(link.expiresAt)) {
        setLink(null)
        setIntent(null)
        return
      }
      setOverride(null)
      reload()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [link, connectDone, relinkDone, reload])

  useEffect(() => {
    if (!link) return
    if (connectDone) {
      setLink(null)
      setIntent(null)
      toast.success('Telegram подключён: сводка будет приходить в личные сообщения')
    } else if (relinkDone) {
      setLink(null)
      setIntent(null)
      toast.success('Уведомления перенесены на новый чат Telegram; из прежнего чата пришло сообщение об этом')
    }
  }, [link, connectDone, relinkDone, toast])

  async function requestLink(nextIntent: 'connect' | 'relink') {
    setRelinkFromLinkedAt(nextIntent === 'relink' ? (data?.linkedAt ?? null) : null)
    const result = await connect.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setIntent(nextIntent)
    setLink(result.data)
    // Новая вкладка сразу после ответа сервера; если браузер её не дал — остаётся
    // кнопка «Открыть Telegram» ниже.
    window.open(result.data.url, '_blank', 'noopener,noreferrer')
  }

  const onConnect = () => requestLink('connect')
  const onRelink = () => requestLink('relink')

  async function onDisconnect() {
    const result = await disconnect.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setLink(null)
    setIntent(null)
    setOverride(result.data)
    toast.success('Уведомления в Telegram отключены')
  }

  let caption: string
  let side: ReactNode = null

  if (!data) {
    caption = status.error ? 'Не удалось узнать состояние. Обновите страницу.' : 'Загрузка…'
    side = status.isLoading ? <Skeleton width="120px" /> : null
  } else if (!data.configured) {
    caption = 'Не настроено администратором.'
  } else if (data.linked && link && intent === 'relink') {
    caption =
      'Откройте ссылку в Telegram в нужном чате и нажмите «Старт»: уведомления перенесутся туда, ' +
      'а в прежний чат придёт одно сообщение о переносе. Ссылка действует 15 минут и срабатывает один раз.'
    side = (
      <Button variant="secondary" href={link.url} external>
        Открыть Telegram
      </Button>
    )
  } else if (data.linked) {
    const who = data.username ? ` как @${data.username}` : ''
    const since = data.linkedAt ? ` · с ${formatDateTime(data.linkedAt)}` : ''
    caption =
      `Подключено${who}${since}. По расписанию приходит сводка «что горит у меня»; ` +
      'в чате с ботом — /today и /stop. «Перепривязать» — перенести уведомления в другой чат Telegram.'
    side = (
      <div className={styles.rowActions}>
        <Badge tone="success" withDot>
          Подключено
        </Badge>
        <Button variant="secondary" onClick={onRelink} isLoading={connect.isPending}>
          Перепривязать
        </Button>
        <Button variant="secondary" onClick={onDisconnect} isLoading={disconnect.isPending}>
          Отключить
        </Button>
      </div>
    )
  } else if (!data.available) {
    return null
  } else {
    caption = link
      ? 'Откройте Telegram и нажмите «Старт». Ссылка действует 15 минут и срабатывает один раз.'
      : 'Сводка «что горит у меня» в личные сообщения: просрочки, блокировки, близкие сроки, рекомендации. ' +
        'В Telegram уходят только названия и сроки — без контактов.'
    side = link ? (
      <Button variant="secondary" href={link.url} external>
        Открыть Telegram
      </Button>
    ) : (
      <Button variant="primary" onClick={onConnect} isLoading={connect.isPending}>
        Подключить
      </Button>
    )
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowTitle}>Уведомления в Telegram</span>
        <span className={styles.rowCaption}>{caption}</span>
      </div>
      <div className={styles.rowSide}>{side}</div>
    </div>
  )
}
