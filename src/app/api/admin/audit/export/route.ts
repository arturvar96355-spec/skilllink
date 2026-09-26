import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, parseQuery } from '@/shared/http'
import * as service from '@/modules/audit/audit.service'
import { auditExportQuerySchema } from '@/modules/audit/audit.schema'

/**
 * Выгрузка журнала для внешней системы сбора событий (решение 133). Только
 * администратор. NDJSON — одна запись на строку, все колонки; курсор следующей
 * страницы — в заголовке `x-last-id` (пусто — записей больше нет).
 * Сама выгрузка пишется в журнал (`audit.export`).
 */
export const dynamic = 'force-dynamic'

export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, auditExportQuerySchema)
  const page = await service.exportAuditEntries(user, query)
  return new Response(page.body, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-last-id': page.lastId ?? '',
      'x-count': String(page.count),
    },
  })
})
