import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/ai-assist/ai-story.service'

type Context = { params: Promise<{ id: string; proposalId: string }> }

/**
 * Применение проекта плана (решение 138): создаёт встречу или переносит срок этапа
 * штатным сервисом — не прямой записью. Повторная проверка прав и версии связки:
 * связка изменилась после постройки проекта — 409, сформируйте план заново.
 * Тело не нужно.
 */
export const POST = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id, proposalId } = await context.params
  return ok(await service.applyProposal(user, id, proposalId))
})
