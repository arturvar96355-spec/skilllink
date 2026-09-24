import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/recommendations/recommendations.service'
import { updateRecommendationSchema } from '@/modules/recommendations/recommendations.schema'

type Context = { params: Promise<{ id: string }> }

export const GET = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.getById(user, id))
})

/**
 * Сотрудник принимает, берёт в работу, закрывает или отклоняет рекомендацию.
 * Переходы — по `RECOMMENDATION_TRANSITIONS`, закрытие — только когда условие ушло.
 */
export const PATCH = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, updateRecommendationSchema)
  return ok(await service.updateStatus(user, id, input))
})
