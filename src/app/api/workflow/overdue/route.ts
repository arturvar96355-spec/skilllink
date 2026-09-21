import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, okList, parseQuery } from '@/shared/http'
import * as service from '@/modules/workflow/workflow.service'
import { stageListQuerySchema } from '@/modules/workflow/workflow.schema'

export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, stageListQuerySchema)
  const { data, meta } = await service.overdue(user, query)
  return okList(data, meta)
})
