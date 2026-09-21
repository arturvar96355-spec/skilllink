import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseQuery } from '@/shared/http'
import { z } from '@/shared/zod'
import * as service from '@/modules/portal/portal.service'

const querySchema = z.object({ universityId: z.string().trim().min(1).optional() })

/** Переданные вузу материалы и признак подтверждения получения. */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const { universityId } = parseQuery(request, querySchema)
  return ok(await service.materials(user, universityId))
})
