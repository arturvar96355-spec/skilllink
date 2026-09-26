import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/data-quality/data-quality.service'

/** Отчёт «Качество справочника»: оценка 0–100 и проблемы со ссылками (решение 134). */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.report(user))
})
