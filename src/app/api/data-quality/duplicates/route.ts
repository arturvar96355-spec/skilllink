import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import * as service from '@/modules/data-quality/data-quality.service'
import { duplicatesQuerySchema } from '@/modules/data-quality/data-quality.schema'

/** Кандидаты в дубли одной сущности, самые похожие первыми (решение 134). */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, duplicatesQuerySchema)
  const { data, meta } = await service.findDuplicates(user, query)
  // Не страница, а список пар целиком: page/pageSize — для общего формата ответа.
  return okList(data, { page: 1, pageSize: data.length, ...meta })
})
