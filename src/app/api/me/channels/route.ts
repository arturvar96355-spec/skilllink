import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import { fromZod } from '@/shared/http/errors'
import { setPrimaryChannelSchema } from '@/modules/notify-channels/notify-channels.schema'
import * as service from '@/modules/notify-channels/notify-channels.service'

/**
 * Каналы уведомлений текущего пользователя (решение 144): Telegram, MAX, VK.
 * Только для себя — пользователь берётся из сессии, идентификатора в запросе нет.
 */

export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.getChannels(user))
})

/** Основной канал: сюда уходит сводка и оповещения, если настроено и привязано несколько. */
export const PUT = handle(async (request) => {
  const user = await getCurrentUser()
  const parsed = setPrimaryChannelSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw fromZod(parsed.error)
  return ok(await service.setPrimary(user, parsed.data.primary))
})
