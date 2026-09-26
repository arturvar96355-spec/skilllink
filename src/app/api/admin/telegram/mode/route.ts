import { resolveSecret } from '@/shared/auth/auth'
import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as adminService from '@/modules/telegram/telegram.admin.service'
import { telegramSetModeSchema } from '@/modules/telegram/telegram.schema'

/** Режим приёма обновлений — webhook/polling/auto (решение 142). Только ADMIN. */
export const dynamic = 'force-dynamic'

export const PUT = handle(async (request) => {
  const user = await getCurrentUser()
  const { mode } = await parseBody(request, telegramSetModeSchema)
  return ok(await adminService.adminSetMode(user, mode, resolveSecret()))
})
