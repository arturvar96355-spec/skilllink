import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/analytics/forecast.service'

type Context = { params: Promise<{ id: string }> }

/** Прогноз связки: вероятность, источник (модель/правило), статус, объяснение (решение 132). */
export const GET = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.getCooperationForecast(user, id))
})
