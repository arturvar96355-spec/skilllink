import { z } from '@/shared/zod'
import { TELEGRAM_MODE_VALUES } from '@/integrations/config'

/**
 * Обновление Telegram — только те поля, которыми бот пользуется (решение 102).
 * Остальное Zod отбрасывает: бот не хранит и не разбирает лишнего о человеке.
 * Чужие виды обновлений (правка сообщения, вступление в группу) проходят схему
 * без `message` и пропускаются.
 */
export const telegramUpdateSchema = z.object({
  update_id: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  message: z
    .object({
      chat: z.object({
        /** До 52 бит по модулю (у групп — отрицательный): в число JavaScript помещается без потерь. */
        id: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
        type: z.string().max(32),
      }),
      from: z.object({ username: z.string().max(64).optional() }).optional(),
      text: z.string().max(4096).optional(),
    })
    .optional(),
})

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
