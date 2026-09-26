import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/ai-assist/ai-story.service'

type Context = { params: Promise<{ id: string }> }

/**
 * Что мешает связке перейти к следующему этапу (решение 138): список причин
 * в порядке важности — по контрольным точкам, чек-листам, документам и статусу
 * связки. Без модели: это уже посчитанные правилами факты, формулировать нечего.
 */
export const GET = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.getCooperationBlockers(user, id))
})
