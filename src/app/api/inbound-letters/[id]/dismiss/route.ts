import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseOptionalBody } from '@/shared/http'
import * as service from '@/modules/inbound-letters/inbound-letters.service'
import { dismissLetterSchema } from '@/modules/inbound-letters/inbound-letters.schema'

type Context = { params: Promise<{ id: string }> }

/** Обращение не по работе (спам) — тело необязательно, можно с комментарием. */
export const POST = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseOptionalBody(request, dismissLetterSchema)
  return ok(await service.dismissLetter(user, id, input))
})
