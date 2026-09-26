import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as experiment from '@/modules/recommendations/experiment/experiment.service'

/**
 * Работают ли рекомендации: группа с рекомендацией против контрольной, прирост
 * с 95 % интервалом и честным статусом (решение 136). Только чтение.
 */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await experiment.getExperimentReport(user))
})
