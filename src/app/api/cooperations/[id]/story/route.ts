import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/ai-assist/ai-story.service'

type Context = { params: Promise<{ id: string }> }

/**
 * История сотрудничества по связке (решение 138): где связка сейчас, что мешает,
 * что сделать дальше — по этапам, встречам, документам и открытым рекомендациям.
 * Факты — без персональных данных; модель, если подключена, только формулирует
 * готовые факты, и ответ с числом, которого нет в фактах, отбрасывается.
 * Модель выключена, не настроена или подвела — тот же текст шаблоном, `source: "template"`.
 */
export const GET = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.getCooperationStory(user, id))
})
