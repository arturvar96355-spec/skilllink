import { getCurrentUser } from '@/shared/auth/current-user'
import { withIdempotency } from '@/shared/idempotency/idempotency'
import { created, handle, okList, parseBody, parseQuery } from '@/shared/http'
import * as service from '@/modules/documents/documents.service'
import {
  createDocumentSchema,
  documentListQuerySchema,
} from '@/modules/documents/documents.schema'

export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, documentListQuerySchema)
  const { data, meta } = await service.list(user, query)
  return okList(data, meta)
})

/** В MVP сохраняются метаданные и ссылка. Загрузка файлов — P2. */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  return withIdempotency(request, user.id, async (body) => {
    const input = await parseBody(body, createDocumentSchema)
    return created(await service.create(user, input))
  })
})
