import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseQuery } from '@/shared/http'
import { z } from '@/shared/zod'
import * as service from '@/modules/portal/portal.service'

const querySchema = z.object({ universityId: z.string().trim().min(1).optional() })

/**
 * Кабинет представителя вуза: свой вуз, его программы, связки и статусы этапов.
 * Аналитики, рейтингов и рекомендаций здесь нет: вузу они не показываются.
 */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const { universityId } = parseQuery(request, querySchema)
  return ok(await service.overview(user, universityId))
})
