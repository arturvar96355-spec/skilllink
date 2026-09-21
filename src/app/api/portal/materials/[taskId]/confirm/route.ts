import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseOptionalBody, parseQuery } from '@/shared/http'
import { z } from '@/shared/zod'
import * as service from '@/modules/portal/portal.service'
import { confirmMaterialSchema } from '@/modules/portal/portal.schema'

const querySchema = z.object({ universityId: z.string().trim().min(1).optional() })

type Context = { params: Promise<{ taskId: string }> }

/** Вуз подтверждает получение материалов (задачи этапа 7). */
export const POST = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { taskId } = await context.params
  const { universityId } = parseQuery(request, querySchema)
  const input = await parseOptionalBody(request, confirmMaterialSchema)
  return ok(await service.confirmMaterial(user, taskId, universityId, input))
})
