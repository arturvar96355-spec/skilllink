import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/universities/universities.service'
import { revealContactSchema } from '@/modules/universities/universities.schema'

type Context = { params: Promise<{ id: string }> }

/**
 * Раскрыть почту и/или телефон контакта вуза с причиной (решение 133).
 * ADMIN, MANAGER; представитель вуза — контакты своего вуза. Каждое раскрытие —
 * запись `contact.revealed` в журнале. Ответ не кэшируется.
 */
export const POST = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, revealContactSchema)
  const response: NextResponse = ok(await service.revealContact(user, id, input))
  response.headers.set('cache-control', 'no-store')
  return response
})
