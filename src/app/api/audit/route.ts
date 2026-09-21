import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import * as service from '@/modules/audit/audit.service'
import { auditListQuerySchema } from '@/modules/audit/audit.schema'

/** Журнал критичных действий (раздел 15 ТЗ). Только для администратора. */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, auditListQuerySchema)
  const { data, meta } = await service.listAuditEntries(user, query)
  return okList(data, meta)
})
