import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import * as service from '@/modules/vendors/vendors.service'
import { vendorListQuerySchema } from '@/modules/vendors/vendors.schema'

/** Реестр вендоров (решение 122). */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, vendorListQuerySchema)
  const { data, meta } = await service.list(user, query)
  return okList(data, meta)
})
