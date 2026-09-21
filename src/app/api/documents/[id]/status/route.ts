import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/documents/documents.service'
import { changeDocumentStatusSchema } from '@/modules/documents/documents.schema'

type Context = { params: Promise<{ id: string }> }

/** Смена статуса документа. Каждое изменение попадает в историю. */
export const PATCH = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, changeDocumentStatusSchema)
  return ok(await service.changeStatus(user, id, input))
})
