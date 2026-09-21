import { getCurrentUser } from '@/shared/auth/current-user'
import { created, handle } from '@/shared/http'
import * as service from '@/modules/documents/documents.service'

type Context = { params: Promise<{ id: string }> }

/**
 * Новая версия документа: создаётся отдельная запись, исходная уходит в архив.
 * Подписанный документ не правится — только версионируется.
 */
export const POST = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return created(await service.createNewVersion(user, id))
})
