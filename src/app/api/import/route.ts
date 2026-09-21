import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseQuery } from '@/shared/http'
import { validationError } from '@/shared/http/errors'
import * as service from '@/modules/import/import.service'
import { importQuerySchema } from '@/modules/import/import.schema'

/** Больше этого тело не читаем: защита от загрузки чего попало. */
const MAX_BODY_BYTES = 2 * 1024 * 1024

/**
 * Загрузка реестра из CSV. Тело — сам файл (`text/csv`).
 *
 * По умолчанию это предпросмотр: запись происходит только при `mode=apply`.
 * Колонки совпадают с заголовками выгрузки, поэтому цикл
 * «выгрузил → поправил в Excel → загрузил обратно» работает без переименований.
 */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, importQuerySchema)

  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) {
    throw validationError('Файл слишком большой', [
      { field: 'csv', message: `Допустимо не больше ${MAX_BODY_BYTES / 1024 / 1024} МБ` },
    ])
  }

  const csv = await request.text()
  return ok(await service.importDataset(user, query, csv))
})
