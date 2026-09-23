import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseQuery, readBodyBytes } from '@/shared/http'
import { validationError } from '@/shared/http/errors'
import * as service from '@/modules/import/import.service'
import { decodeCsv } from '@/modules/import/decode'
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
  // Права — до чтения тела: без них файл не нужен вовсе, а читать его — работа
  // и память, которые может заказать кто угодно из вошедших.
  service.assertCanImport(user)
  const query = parseQuery(request, importQuerySchema)

  const tooLarge = () =>
    validationError('Файл слишком большой', [
      { field: 'csv', message: `Допустимо не больше ${MAX_BODY_BYTES / 1024 / 1024} МБ` },
    ])

  // Размер проверяется по мере чтения, а не после: при потоковой передаче
  // (chunked) заголовка длины нет, и `arrayBuffer()` успевал прочитать в память
  // всё присланное, прежде чем доходило до сравнения.
  //
  // Файл читается байтами, а не `request.text()`: тот всегда декодирует UTF-8,
  // а Excel в Windows сохраняет CSV в Windows-1251 (см. import/decode.ts).
  const bytes = await readBodyBytes(request, MAX_BODY_BYTES, tooLarge)

  const { text, encoding } = decodeCsv(bytes)
  return ok(await service.importDataset(user, query, text, encoding))
})
