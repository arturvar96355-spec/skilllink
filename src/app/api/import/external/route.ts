import { handle, ok, parseBody } from '@/shared/http'
import { assertIntegrationRequest } from '@/modules/import/external.auth'
import { externalImportSchema } from '@/modules/import/external.schema'
import { importExternal } from '@/modules/import/external.service'

/**
 * Приём данных извне — сайт и LMS (решение 145, ТЗ функц. требования п.5).
 *
 * Авторизация машинная (Bearer INTEGRATION_TOKEN), без cookie сессии — поэтому
 * здесь нет `getCurrentUser()`. Идемпотентно по (source, externalId): повтор — 200
 * с тем же id связки.
 */
export const POST = handle(async (request) => {
  assertIntegrationRequest(request)
  const input = await parseBody(request, externalImportSchema)
  return ok(await importExternal(input))
})
