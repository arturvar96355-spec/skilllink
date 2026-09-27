import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import { teamOverview } from '@/modules/analytics/team.service'

/**
 * Экран «Команда» (решение 203): сводка по всем сотрудникам — связки в работе, вузы,
 * ближайший срок, просрочки, встречи недели, задания по письмам, последнее действие,
 * нагрузка — и итоги команды. ADMIN, HEAD и эксперт (чтение); остальным 403.
 */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await teamOverview(user))
})
