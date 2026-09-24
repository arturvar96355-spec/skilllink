import { getCurrentUser } from '@/shared/auth/current-user'
import { created, handle, okList, parseBody, parseQuery } from '@/shared/http'
import * as service from '@/modules/products/products.service'
import { createProductSchema, productListQuerySchema } from '@/modules/products/products.schema'

export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, productListQuerySchema)
  const { data, meta } = await service.list(user, query)
  return okList(data, meta)
})

export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const input = await parseBody(request, createProductSchema)
  return created(await service.create(user, input))
})
