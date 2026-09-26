import { z } from '@/shared/zod'

/**
 * Входящие обновления MAX и VK (решение 144) — только поля, которыми пользуется
 * привязка и команды «сегодня»/«стоп». Остальное Zod отбрасывает, как у Telegram
 * (telegram.schema.ts).
 *
 * Точный состав полей MAX Update — по документации dev.max.ru/docs-api на момент
 * написания (страницы методов — SPA, не всё зеркалится статикой); при подключении
 * настоящего бота стоит сверить `update_type`, `payload` и идентификаторы диалога
 * с реальным событием и поправить схему — граница описана в docs/SECURITY_LIMITATIONS.md.
 */
export const maxUpdateSchema = z.object({
  update_type: z.string().max(64),
  timestamp: z.number().int().optional(),
  /** Событие «пользователь запустил бота» — по диплинку с кодом привязки. */
  chat_id: z.union([z.number().int(), z.string().max(64)]).optional(),
  user: z
    .object({
      user_id: z.union([z.number().int(), z.string().max(64)]),
      username: z.string().max(64).nullish(),
    })
    .optional(),
  /** Стартовый параметр диплинка (см. предупреждение выше — поле уточняется по факту). */
  payload: z.string().max(200).nullish(),
  message: z
    .object({
      sender: z
        .object({
          user_id: z.union([z.number().int(), z.string().max(64)]),
          username: z.string().max(64).nullish(),
        })
        .optional(),
      recipient: z
        .object({
          chat_id: z.union([z.number().int(), z.string().max(64)]).optional(),
          user_id: z.union([z.number().int(), z.string().max(64)]).optional(),
        })
        .optional(),
      body: z
        .object({
          mid: z.string().max(128).optional(),
          text: z.string().max(4000).nullish(),
        })
        .optional(),
    })
    .optional(),
})

export type MaxUpdate = z.infer<typeof maxUpdateSchema>

/**
 * Событие Callback API сообщества VK. `type: 'confirmation'` подтверждает адрес
 * при включении Callback API — ответ должен быть открытым текстом с кодом из
 * VK_CONFIRMATION_CODE, не JSON. `secret` сверяется с VK_SECRET (не заголовок,
 * а поле тела — так устроен Callback API VK).
 */
export const vkCallbackEventSchema = z.object({
  type: z.string().max(64),
  group_id: z.number().int().optional(),
  /** Идентификатор события — для дедупликации повторов (channel_updates_seen). */
  event_id: z.string().max(128).optional(),
  secret: z.string().max(256).optional(),
  object: z
    .object({
      message: z
        .object({
          id: z.number().int().optional(),
          from_id: z.union([z.number().int(), z.string().max(64)]),
          peer_id: z.union([z.number().int(), z.string().max(64)]).optional(),
          text: z.string().max(4096).nullish(),
          /** Метка перехода по ссылке vk.me/<сообщество>?ref=<код> (решение 144). */
          ref: z.string().max(200).nullish(),
        })
        .optional(),
    })
    .optional(),
})

export type VkCallbackEvent = z.infer<typeof vkCallbackEventSchema>

/** PUT /api/me/channels: тело запроса — основной канал (null — снова автоматически). */
export const setPrimaryChannelSchema = z.object({
  primary: z.enum(['telegram', 'max', 'vk']).nullable(),
})
