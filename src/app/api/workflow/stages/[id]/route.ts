import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/workflow/workflow.service'
import { updateStageSchema } from '@/modules/workflow/workflow.schema'

type Context = { params: Promise<{ id: string }> }

/** Изменение этапа. Недопустимый переход — ошибка INVALID_TRANSITION (409). */
export const PATCH = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, updateStageSchema)
  return ok(await service.updateStage(user, id, input))
})
