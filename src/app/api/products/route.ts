import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import * as service from '@/modules/products/products.service'
import { productListQuerySchema } from '@/modules/products/products.schema'

export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, productListQuerySchema)
  const { data, meta } = await service.list(user, query)
  return okList(data, meta)
})
