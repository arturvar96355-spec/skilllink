import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/inbound-letters/inbound-letters.service'

type Context = { params: Promise<{ id: string }> }

/** Разобрать письмо заново — код и, если подключена модель, она; правила — запасной путь. */
export const POST = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.analyzeLetter(user, id))
})
