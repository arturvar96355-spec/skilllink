import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/ai-assist/ai-assist.service'

type Context = { params: Promise<{ id: string; productId: string }> }

/**
 * Черновик письма вузу с предложением продукта (решение 223). Письмо не отправляется
 * и не сохраняется: это текст для сотрудника. Без модели — шаблон на тех же фактах.
 */
export const POST = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id, productId } = await context.params
  return ok(await service.draftProductOfferLetter(user, id, productId))
})
