import { getCurrentUser } from '@/shared/auth/current-user'
import { created, handle, ok } from '@/shared/http'
import * as service from '@/modules/calendar/calendar.service'

/**
 * Личная подписка на календарь сроков и встреч (решение 105). Только сотрудники.
 * Кэш ответов запрещён в next.config.ts: в ответе на выпуск — ссылка-доступ.
 */

/** Есть ли действующая ссылка. Самого адреса в ответе нет. */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.status(user))
})

/** Выпустить или перевыпустить ссылку. Адрес — только в этом ответе. */
export const POST = handle(async () => {
  const user = await getCurrentUser()
  return created(await service.issue(user))
})

/** Отозвать ссылку: календари, подписанные на неё, перестают обновляться. */
export const DELETE = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.revoke(user))
})
