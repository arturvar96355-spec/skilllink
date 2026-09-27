import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseQuery } from '@/shared/http'
import * as service from '@/modules/recommendations/product-match.service'

/** Рекомендации продуктов по всему портфелю: лучшая пара каждой программы (решение 223). */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, service.portfolioQuerySchema)
  return ok(await service.forPortfolio(user, query))
})
