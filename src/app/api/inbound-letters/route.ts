import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import * as service from '@/modules/inbound-letters/inbound-letters.service'
import { inboundLetterListQuerySchema } from '@/modules/inbound-letters/inbound-letters.schema'

/**
 * Письма вузов как обращения (решение 170). ADMIN и HEAD видят все обращения,
 * MANAGER — только своих вузов (где он ответственный за вуз или найденную связку).
 */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, inboundLetterListQuerySchema)
  const { data, meta } = await service.list(user, query)
  return okList(data, meta)
})
