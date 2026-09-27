import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/inbound-letters/inbound-letters.service'

type Context = { params: Promise<{ id: string }> }

/**
 * «Принять в работу» по письму вуза из интерфейса — карточка письма и колокольчик
 * (решение 213). То же, что «✓ Принял» в Telegram (решение 200): отметка в журнале,
 * письмо не меняется. Повтор тем же человеком — та же отметка, `alreadyAccepted: true`.
 */
export const POST = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.acceptLetterFromWeb(user, id))
})
