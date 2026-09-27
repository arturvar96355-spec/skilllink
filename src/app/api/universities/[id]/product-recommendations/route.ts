import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseQuery } from '@/shared/http'
import * as service from '@/modules/recommendations/product-match.service'

type Context = { params: Promise<{ id: string }> }

/** «Что предложить вузу» в карточке вуза: по всем его программам, продукт один раз (решение 223). */
export const GET = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const query = parseQuery(request, service.cardQuerySchema)
  return ok(await service.forUniversity(user, id, query))
})
