import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/workflow/workflow.service'
import { updateTaskSchema } from '@/modules/workflow/workflow.schema'

type Context = { params: Promise<{ id: string }> }

/** Отметка пункта чек-листа. В ответе — этап целиком, чтобы фронт обновил прогресс. */
export const PATCH = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, updateTaskSchema)
  return ok(await service.toggleTask(user, id, input))
})
