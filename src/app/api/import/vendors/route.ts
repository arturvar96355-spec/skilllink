import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseQuery, readBodyBytes } from '@/shared/http'
import { validationError } from '@/shared/http/errors'
import * as service from '@/modules/vendors/vendors.service'
import { vendorImportQuerySchema } from '@/modules/vendors/vendors.schema'

/** Больше этого тело не читаем: файл вендоров — десятки строк. */
const MAX_BODY_BYTES = 2 * 1024 * 1024

/**
 * Загрузка вендоров, продуктов и контактов (решение 122). Тело — сам файл:
 * книга Excel (.xlsx) или CSV. По умолчанию предпросмотр, запись — `mode=apply`.
 */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  // Права — до чтения тела, как у загрузки реестров.
  service.assertCanImportVendors(user)
  const query = parseQuery(request, vendorImportQuerySchema)
  const bytes = await readBodyBytes(request, MAX_BODY_BYTES, () =>
    validationError('Файл слишком большой', [
      { field: 'file', message: `Допустимо не больше ${MAX_BODY_BYTES / 1024 / 1024} МБ` },
    ]),
  )
  return ok(await service.importVendors(user, query, bytes))
})
