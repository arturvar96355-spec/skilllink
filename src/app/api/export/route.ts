import { getCurrentUser } from '@/shared/auth/current-user'
import { handle } from '@/shared/http'
import * as service from '@/modules/export/export.service'
import { parseExportRequest } from '@/modules/export/export.schema'

/**
 * Выгрузка реестра в CSV для Excel.
 * Права совпадают с правами соответствующего раздела: выгрузка — не обходной путь к данным.
 * Фильтры — те же параметры, что у списка раздела.
 */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const result = await service.exportDataset(user, parseExportRequest(request))

  return new Response(result.csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${result.fileName}"`,
      'x-total-rows': String(result.rows),
    },
  })
})
