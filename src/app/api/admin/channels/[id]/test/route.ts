import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import { notFound } from '@/shared/http/errors'
import { isChannelId } from '@/modules/notify-channels/notify-channels.types'
import * as service from '@/modules/notify-channels/notify-channels.service'

type Context = { params: Promise<{ id: string }> }

/**
 * Проверить канал (решение 144): пробное сообщение администратору в его собственный
 * чат — сначала он должен подключить канал себе. Тела не нужно.
 */
export const POST = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  if (!isChannelId(id)) throw notFound('Канал не найден')
  return ok(await service.testChannel(user, id))
})
