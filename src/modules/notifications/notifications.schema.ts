import { z } from 'zod'
import {
  NOTIFICATION_DEFAULT_LIMIT,
  NOTIFICATION_MAX_LIMIT,
} from '@/shared/config/notifications.config'

export const notificationFeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(NOTIFICATION_MAX_LIMIT).default(NOTIFICATION_DEFAULT_LIMIT),
  /**
   * Необязательная подсказка от клиента (обратная совместимость со старым фронтом,
   * хранившим отметку только в localStorage). Источник истины — серверное значение
   * (решение 139); итоговая граница — более позднее из двух.
   */
  since: z.iso.datetime({ offset: true, message: 'Ожидается дата в формате ISO 8601' }).optional(),
})

export type NotificationFeedQuery = z.infer<typeof notificationFeedQuerySchema>

/**
 * Тело `POST /api/notifications/seen` (решение 139).
 * Без `seenAt` ставится серверное «сейчас»; с `seenAt` — переданное время, если оно
 * не в будущем (проверяется в сервисе: схема не знает текущего времени сервера).
 */
export const markNotificationsSeenSchema = z.object({
  seenAt: z.iso.datetime({ offset: true, message: 'Ожидается дата в формате ISO 8601' }).optional(),
})

export type MarkNotificationsSeenInput = z.infer<typeof markNotificationsSeenSchema>
