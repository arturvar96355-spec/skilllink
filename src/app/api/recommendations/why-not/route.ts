import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseQuery } from '@/shared/http'
import * as service from '@/modules/recommendations/recommendations.learning.service'
import { whyNotQuerySchema } from '@/modules/recommendations/recommendations.schema'

/**
 * Почему по объекту нет рекомендации (решение 119): те же проверки, что у правила
 * при пересборке, — каждая с результатом и текстом из фактов.
 */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, whyNotQuerySchema)
  return ok(await service.whyNot(user, query))
})
