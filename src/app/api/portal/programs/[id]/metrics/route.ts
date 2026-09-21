import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody, parseQuery } from '@/shared/http'
import { z } from '@/shared/zod'
import * as service from '@/modules/portal/portal.service'
import { updateProgramMetricsSchema } from '@/modules/portal/portal.schema'

const querySchema = z.object({ universityId: z.string().trim().min(1).optional() })

type Context = { params: Promise<{ id: string }> }

/**
 * Вуз вносит численность обучающихся и количество групп.
 * Заявки сюда не входят: они считаются по поданным заявкам.
 */
export const PATCH = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const { universityId } = parseQuery(request, querySchema)
  const input = await parseBody(request, updateProgramMetricsSchema)
  return ok(await service.updateProgramMetrics(user, id, universityId, input))
})
