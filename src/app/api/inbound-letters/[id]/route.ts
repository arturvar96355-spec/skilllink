import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/inbound-letters/inbound-letters.service'

type Context = { params: Promise<{ id: string }> }

/** Карточка обращения — полный текст письма, разбор, итог проверки, задание, черновик ответа. */
export const GET = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.getById(user, id))
})
