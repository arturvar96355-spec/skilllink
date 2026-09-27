import { z } from '@/shared/zod'
import { TELEGRAM_MODE_VALUES } from '@/integrations/config'

const chatIdSchema = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)

const chatSchema = z.object({
  /** До 52 бит по модулю (у групп — отрицательный): в число JavaScript помещается без потерь. */
  id: chatIdSchema,
  type: z.string().max(32),
})

/**
 * Кнопки под сообщением бота, как их возвращает Telegram в нажатии (решение 200):
 * нужны, чтобы при правке сообщения убрать нажатую кнопку и оставить остальные.
 * Кнопки чужих видов (оплата, игра) бот не создаёт — схема их не принимает.
 */
const inlineKeyboardSchema = z.object({
  inline_keyboard: z
    .array(
      z
        .array(
          z.object({
            text: z.string().max(256),
            url: z.string().max(2048).optional(),
            callback_data: z.string().max(64).optional(),
          }),
        )
        .max(8),
    )
    .max(100),
})

/**
 * Нажатие inline-кнопки (решение 200). `message` — сообщение с кнопкой: у старых или
 * удалённых оно приходит без текста (InaccessibleMessage), у сообщений inline-режима
 * его нет вовсе — такие нажатия бот не обрабатывает (inline-режима у него нет).
 */
const callbackQuerySchema = z.object({
  id: z.string().min(1).max(128),
  from: z.object({ id: chatIdSchema }),
  message: z
    .object({
      message_id: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      chat: chatSchema,
      text: z.string().max(4096).optional(),
      reply_markup: inlineKeyboardSchema.optional(),
    })
    .optional(),
  /** Предел Bot API — 64 байта; длиннее — не наше. */
  data: z.string().max(64).optional(),
})

/**
 * Обновление Telegram — только те поля, которыми бот пользуется (решение 102).
 * Остальное Zod отбрасывает: бот не хранит и не разбирает лишнего о человеке.
 * Чужие виды обновлений (правка сообщения, вступление в группу) проходят схему
 * без `message` и `callback_query` и пропускаются.
 */
export const telegramUpdateSchema = z.object({
  update_id: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  message: z
    .object({
      chat: chatSchema,
      from: z.object({ username: z.string().max(64).optional() }).optional(),
      text: z.string().max(4096).optional(),
    })
    .optional(),
  callback_query: callbackQuerySchema.optional(),
})

export type TelegramCallbackQuery = z.infer<typeof callbackQuerySchema>

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>

/**
 * PUT /api/admin/telegram/token (решение 142). Токен BotFather — цифры, двоеточие,
 * буквы/цифры/`_`/`-` (формат Bot API); длина — с запасом вокруг обычных 45–50 знаков.
 */
export const telegramSetTokenSchema = z.object({
  token: z
    .string()
    .trim()
    .min(20, 'Слишком короткий токен — проверьте, что он скопирован целиком')
    .max(200)
    .regex(/^\d+:[A-Za-z0-9_-]+$/, 'Похоже, это не токен Bot API — он выглядит как 123456789:AA...'),
})

/** PUT /api/admin/telegram/mode. */
export const telegramSetModeSchema = z.object({
  mode: z.enum(TELEGRAM_MODE_VALUES),
})
