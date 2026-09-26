import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/inbound-letters/inbound-letters.service'
import { reviewLetterSchema } from '@/modules/inbound-letters/inbound-letters.schema'

type Context = { params: Promise<{ id: string }> }

/**
 * Проверка разбора: «Верно» (`{ verdict: 'CORRECT' }`) или «Неверно»
 * (`{ verdict: 'INCORRECT', universityId, cooperationId?, group, action, comment }`).
 * Создаёт задание ответственному за вуз и размеченный пример для следующего разбора.
 */
export const POST = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, reviewLetterSchema)
  return ok(await service.review(user, id, input))
})
