import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import * as service from '@/modules/documents/documents.service'

/** Шаблоны документов и поддерживаемые подстановки реквизитов. */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok({
    templates: service.listTemplates(user),
    placeholders: service.listPlaceholders(),
  })
})
