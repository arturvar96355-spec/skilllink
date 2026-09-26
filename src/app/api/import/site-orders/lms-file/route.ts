import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, parseQuery, readBodyBytes } from '@/shared/http'
import { validationError } from '@/shared/http/errors'
import { XLSX_CONTENT_TYPE } from '@/shared/files/xlsx'
import * as service from '@/modules/enrollment/enrollment.service'
import { lmsFileQuerySchema } from '@/modules/enrollment/enrollment.schema'

const MAX_BODY_BYTES = 2 * 1024 * 1024

/**
 * Файл «Загрузка пользователей» для LMS из того же файла заказов (решение 122).
 * Ответ — книга Excel. В файле ФИО, телефоны и почты слушателей, поэтому ни браузер,
 * ни прокси не должны его сохранять: `no-store`.
 */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  service.assertCanImportOrders(user)
  const query = parseQuery(request, lmsFileQuerySchema)
  const bytes = await readBodyBytes(request, MAX_BODY_BYTES, () =>
    validationError('Файл слишком большой', [
      { field: 'file', message: `Допустимо не больше ${MAX_BODY_BYTES / 1024 / 1024} МБ` },
    ]),
  )
  const result = await service.buildLmsFile(user, query, service.parseOrdersBody(bytes))

  return new Response(new Uint8Array(result.file), {
    status: 200,
    headers: {
      'content-type': XLSX_CONTENT_TYPE,
      'content-disposition': `attachment; filename="${result.fileName}"`,
      'cache-control': 'no-store',
      'x-total-rows': String(result.rows),
      'x-skipped-not-imported': String(result.skippedNotImported),
      'x-skipped-already-exported': String(result.skippedAlreadyExported),
      'x-duplicates-merged': String(result.duplicatesMerged),
    },
  })
})
