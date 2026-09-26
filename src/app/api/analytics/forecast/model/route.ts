import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/analytics/forecast.service'

/** Метрики, статус ворот, коэффициенты и калибровка модели прогноза (решение 135). */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.getModels(user))
})
