import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/ai-assist/ai-assist.service'

type Context = { params: Promise<{ id: string }> }

/**
 * Черновик письма вузу по рекомендации (решение 90). Письмо не отправляется:
 * это текст для сотрудника, который он проверяет и отправляет сам.
 */
export const POST = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.draftRecommendationLetter(user, id))
})
