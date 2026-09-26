import { resolveSecret } from '@/shared/auth/auth'
import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import { notFound } from '@/shared/http/errors'
import { isChannelId } from '@/modules/notify-channels/notify-channels.types'
import * as service from '@/modules/notify-channels/notify-channels.service'

type Context = { params: Promise<{ id: string }> }

/**
 * Ссылка «Подключить»/«Перепривязать» канал (решение 144). Ничего не создаёт —
 * привязка появится, только когда человек перейдёт по ссылке и напишет боту.
 * Тела нет.
 */
export const POST = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  if (!isChannelId(id)) throw notFound('Канал не найден')
  return ok(await service.connect(user, id, resolveSecret()))
})
