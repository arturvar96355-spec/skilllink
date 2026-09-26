import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/ai-assist/ai-story.service'

type Context = { params: Promise<{ id: string }> }

/**
 * История сотрудничества с вузом (решение 138): сколько связок и в каком они
 * состоянии, что мешает дальше всего продвинуться. Факты — из связок вуза
 * и его встреч, без персональных данных; модель, если подключена, только
 * формулирует. Модель выключена или подвела — тот же текст шаблоном.
 */
export const GET = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.getUniversityStory(user, id))
})
