import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseQuery } from '@/shared/http'
import { z } from '@/shared/zod'
import * as service from '@/modules/portal/portal.service'

const querySchema = z.object({ universityId: z.string().trim().min(1).optional() })

/** Документы вуза — те, что считает `documentsCount` сводки кабинета (решение 235). */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const { universityId } = parseQuery(request, querySchema)
  return ok(await service.documents(user, universityId))
})
