import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, parseQuery } from '@/shared/http'
import * as service from '@/modules/export/export.service'
import { exportQuerySchema } from '@/modules/export/export.schema'

/**
 * Выгрузка реестра в CSV для Excel.
 * Права совпадают с правами соответствующего раздела: выгрузка — не обходной путь к данным.
 */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, exportQuerySchema)
  const result = await service.exportDataset(user, query)

  return new Response(result.csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${result.fileName}"`,
      'x-total-rows': String(result.rows),
    },
  })
})
