import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import { teamMemberProfile } from '@/modules/analytics/team.service'
import { teamMemberParamsSchema } from '@/modules/analytics/team.schema'

type Context = { params: Promise<{ userId: string }> }

/**
 * Страница сотрудника `/team/:id` (решение 230): всё из боковой панели «Команды» тем же
 * расчётом плюс рабочая почта. «Команда» (ADMIN, HEAD, эксперт) видит любого сотрудника,
 * остальные сотрудники ИТ-Школы — только себя; представителю вуза — 403.
 */
export const GET = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { userId } = teamMemberParamsSchema.parse(await context.params)
  return ok(await teamMemberProfile(user, userId))
})
