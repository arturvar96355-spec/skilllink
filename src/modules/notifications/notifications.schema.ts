import { z } from 'zod'
import {
  NOTIFICATION_DEFAULT_LIMIT,
  NOTIFICATION_MAX_LIMIT,
} from '@/shared/config/notifications.config'

export const notificationFeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(NOTIFICATION_MAX_LIMIT).default(NOTIFICATION_DEFAULT_LIMIT),
  /** Когда пользователь последний раз смотрел ленту: всё новее — непрочитанное. */
  since: z.iso.datetime({ offset: true, message: 'Ожидается дата в формате ISO 8601' }).optional(),
})

export type NotificationFeedQuery = z.infer<typeof notificationFeedQuerySchema>
