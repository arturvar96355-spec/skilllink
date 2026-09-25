import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/settings/settings.service'

/** Текущие коэффициенты, пороги и нормативы расчётов — только чтение (решение 107). */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(service.getCalculationParameters(user))
})
