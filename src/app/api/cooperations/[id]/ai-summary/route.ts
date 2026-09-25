import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/ai-assist/ai-assist.service'

type Context = { params: Promise<{ id: string }> }

/**
 * Сводка по связке от ИИ-помощника (решение 84): где связка, что мешает, что дальше.
 * Факты — из карточки связки и её открытых рекомендаций; модель только формулирует.
 * Модель выключена или подвела — тот же текст шаблоном, `source: "template"`.
 */
export const POST = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.summarizeCooperation(user, id))
})
