import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/vendors/vendors.service'

type Context = { params: Promise<{ id: string }> }

/** Карточка вендора: продукты, контакты, связки через продукты, курсы (решение 122). */
export const GET = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.getById(user, id))
})
