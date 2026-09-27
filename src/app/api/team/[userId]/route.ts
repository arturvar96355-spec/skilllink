import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import { teamMemberDetail } from '@/modules/analytics/team.service'
import { teamMemberParamsSchema } from '@/modules/analytics/team.schema'

type Context = { params: Promise<{ userId: string }> }

/**
 * Боковая панель сотрудника на экране «Команда» (решение 203): его связки, просроченные
 * этапы, этапы и встречи этой недели, последние действия — только безопасные поля журнала.
 */
export const GET = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { userId } = teamMemberParamsSchema.parse(await context.params)
  return ok(await teamMemberDetail(user, userId))
})
