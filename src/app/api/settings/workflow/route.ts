import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/workflow/workflow-templates.service'

/**
 * Хранимый шаблон 14 этапов (ТЗ, функц. требования пп. 6, 9; решение 146).
 * Только ADMIN. Источник значений для НОВЫХ связок — существующие не меняются.
 */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.getSettings(user))
})
