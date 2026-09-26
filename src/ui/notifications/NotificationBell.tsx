'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import type { NotificationDto, NotificationFeedDto } from '@/shared/contracts'
import { Button } from '../primitives/Button'
import { Icon, type IconName } from '../primitives/Icon'
import { IconButton } from '../primitives/IconButton'
import { Skeleton } from '../primitives/Skeleton'
import { useResource } from '../hooks/useResource'
import { useOutsideClick, useEscape, useStoredValue } from '../hooks/dom'
import { apiPost, buildQuery } from '../lib/api'
import { formatRelative } from '../lib/format'
import { notificationHref } from '../lib/links'
import styles from './Notifications.module.css'

/**
 * Ключ отметки «просмотрено» в localStorage — быстрый локальный кэш.
 * Источник истины — сервер, `users.notifications_seen_at` (решение 139),
 * его ставит `POST /api/notifications/seen`.
 */
const SEEN_KEY = 'skilllink:notifications:seen-at'

/** Отметить ленту просмотренной на сервере. Не критично для интерфейса — localStorage уже обновлён. */
function markSeenOnServer(seenAt?: string): void {
  void apiPost('/api/notifications/seen', seenAt ? { seenAt } : undefined).catch(() => {
    // Сервер не узнал об этом просмотре — при следующем открытии колокольчика попробуем снова.
  })
}

const KIND_ICONS: Record<NotificationDto['kind'], IconName> = {
  'stage.overdue': 'alert',
  'stage.due-soon': 'clock',
  'stage.changed': 'cooperation',
  'document.changed': 'document',
  recommendation: 'recommendation',
  'university.responsible-changed': 'university',
}

/**
 * Колокольчик и лента событий.
 *
 * Лента собирается сервером из сроков, истории этапов и документов —
 * отдельного хранилища уведомлений нет, поэтому она не может разойтись
 * с данными. Прочитанность хранит сервер (решение 139); localStorage здесь —
 * быстрый локальный кэш для отправки `since` до первого ответа сервера.
 */
export function NotificationBell() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const { value: seenAt, store: storeSeenAt, isReady } = useStoredValue(SEEN_KEY)

  const close = useCallback(() => setIsOpen(false), [])
  const panelRef = useOutsideClick<HTMLDivElement>(close, isOpen)
  useEscape(close, isOpen)

  // До чтения отметки запрос не отправляем: иначе первый ответ пришёл бы
  // без `since` и всё показалось бы непрочитанным.
  const path = isReady
    ? `/api/notifications${buildQuery({ limit: 20, since: seenAt ?? undefined })}`
    : null
  const feed = useResource<NotificationFeedDto>(path, { keepPreviousData: true })

  const unread = feed.data?.unreadCount ?? 0
  const items = useMemo(() => feed.data?.items ?? [], [feed.data])
  const now = useMemo(() => Date.now(), [feed.data])

  function open() {
    setIsOpen((current) => {
      // Открываем — перечитываем ленту: она могла измениться, пока страница висела.
      // Заодно сообщаем серверу, что колокольчик открыли: устройство сменится
      // или localStorage очистят — отметка на сервере всё равно останется.
      if (!current) {
        feed.reload()
        markSeenOnServer()
      }
      return !current
    })
  }

  function markAllRead() {
    const seenAt = new Date().toISOString()
    storeSeenAt(seenAt)
    markSeenOnServer(seenAt)
  }

  function openTarget(item: NotificationDto) {
    // Переход к объекту закрывает ленту и отмечает всё просмотренным:
    // пользователь ленту увидел, держать значок дальше незачем.
    markAllRead()
    close()
    router.push(notificationHref(item.target))
  }

  return (
    <div className={styles.wrapper} ref={panelRef}>
      <IconButton
        icon="bell"
        label={unread > 0 ? `Уведомления: ${unread} непрочитанных` : 'Уведомления'}
        isActive={isOpen}
        onClick={open}
        aria-expanded={isOpen}
      />
      {unread > 0 && (
        <span className={styles.badge} aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      )}

      {isOpen && (
        <div className={styles.panel} role="dialog" aria-label="Уведомления">
          <div className={styles.head}>
            <span className={styles.title}>
              Уведомления
              {unread > 0 && <span className={styles.count}>{unread} новых</span>}
            </span>
            {unread > 0 && (
              <Button variant="ghost" size="sm" onClick={markAllRead}>
                Отметить прочитанным
              </Button>
            )}
          </div>

          {feed.isLoading ? (
            <div className={styles.loading}>
              <Skeleton height="40px" />
              <Skeleton height="40px" />
              <Skeleton height="40px" />
            </div>
          ) : feed.error ? (
            <p className={styles.empty}>{feed.error.message}</p>
          ) : items.length === 0 ? (
            <p className={styles.empty}>Событий, требующих внимания, нет.</p>
          ) : (
            <div className={styles.list}>
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={[styles.item, item.isUnread ? styles.unread : ''].filter(Boolean).join(' ')}
                  onClick={() => openTarget(item)}
                >
                  <span className={[styles.icon, styles[item.severity]].join(' ')}>
                    <Icon name={KIND_ICONS[item.kind]} size={18} />
                  </span>
                  <span className={styles.text}>
                    <span className={styles.itemTitle}>{item.title}</span>
                    {item.description && (
                      <span className={styles.itemDescription}>{item.description}</span>
                    )}
                    <span className={styles.time}>{formatRelative(item.occurredAt, now)}</span>
                  </span>
                  {item.isUnread && <span className={styles.dot} aria-label="Новое" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
