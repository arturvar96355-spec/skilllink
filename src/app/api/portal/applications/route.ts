import { getCurrentUser } from '@/shared/auth/current-user'
import { created, handle, okList, parseBody, parseQuery } from '@/shared/http'
import { z } from '@/shared/zod'
import * as service from '@/modules/portal/portal.service'
import {
  applicationListQuerySchema,
  submitApplicationSchema,
} from '@/modules/portal/portal.schema'

const universityQuerySchema = z.object({ universityId: z.string().trim().min(1).optional() })

export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, applicationListQuerySchema.extend(universityQuerySchema.shape))
  const { data, meta } = await service.listApplications(user, query.universityId, query)
  return okList(data, meta)
})

/** Подача заявки на обучение. Персональных данных обучающихся не содержит. */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const { universityId } = parseQuery(request, universityQuerySchema)
  const input = await parseBody(request, submitApplicationSchema)
  return created(await service.submitApplication(user, universityId, input))
})
