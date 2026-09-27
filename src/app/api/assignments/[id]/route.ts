import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/assignments/assignments.service'
import { updateAssignmentSchema } from '@/modules/assignments/assignments.schema'

type Context = { params: Promise<{ id: string }> }

/** Автор меняет поручение целиком, исполнитель — только статус (решение 207). */
export const PATCH = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, updateAssignmentSchema)
  return ok(await service.update(user, id, input))
})
