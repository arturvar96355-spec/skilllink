import { resolveSecret } from '@/shared/auth/auth'
import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/telegram/telegram.service'

/**
 * Уведомления в Telegram для текущего пользователя (решение 102).
 * Только для себя: пользователь берётся из сессии, идентификатора в запросе нет.
 */

/** Состояние блока в личном кабинете: настроен ли бот, доступна ли сводка, подключён ли чат. */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.getStatus(user))
})

/** Ссылка на бота с одноразовым токеном привязки. Ничего не создаёт — 200. */
export const POST = handle(async () => {
  const user = await getCurrentUser()
  return ok(service.connect(user, resolveSecret()))
})

/** Отключить: привязка удаляется. Повтор — не ошибка. */
export const DELETE = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.disconnect(user))
})
