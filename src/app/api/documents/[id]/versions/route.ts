import { getCurrentUser } from '@/shared/auth/current-user'
import { withIdempotency } from '@/shared/idempotency/idempotency'
import { created, handle } from '@/shared/http'
import * as service from '@/modules/documents/documents.service'

type Context = { params: Promise<{ id: string }> }

/**
 * Новая версия документа: создаётся отдельная запись, исходная уходит в архив.
 * Подписанный документ не правится — только версионируется.
 * С заголовком Idempotency-Key двойной щелчок не даёт двух версий (решение 123).
 */
export const POST = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return withIdempotency(request, user.id, async () => created(await service.createNewVersion(user, id)))
})
