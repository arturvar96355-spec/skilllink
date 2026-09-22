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

  const tooLarge = () =>
    validationError('Файл слишком большой', [
      { field: 'csv', message: `Допустимо не больше ${MAX_BODY_BYTES / 1024 / 1024} МБ` },
    ])

  // Заголовок проверяется первым: он позволяет отказать, не читая тело.
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) throw tooLarge()

  // Но полагаться на него нельзя: при потоковой передаче (chunked) заголовка
  // нет вовсе, и ограничение обходилось простым его отсутствием. Поэтому
  // размер проверяется и по факту прочитанного.
  const csv = await request.text()
  if (Buffer.byteLength(csv, 'utf8') > MAX_BODY_BYTES) throw tooLarge()
  return ok(await service.importDataset(user, query, csv))
})
