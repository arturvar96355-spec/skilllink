import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/inbound-letters/inbound-letters.service'
import { updateReplyDraftSchema } from '@/modules/inbound-letters/inbound-letters.schema'

type Context = { params: Promise<{ id: string }> }

/** Черновик ответа вузу — моделью или шаблоном. Отправки нет: в ответе только `mailto`. */
export const POST = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.generateReplyDraft(user, id))
})

/** Правка текста черновика вручную. */
export const PATCH = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, updateReplyDraftSchema)
  return ok(await service.updateReplyDraft(user, id, input))
})
