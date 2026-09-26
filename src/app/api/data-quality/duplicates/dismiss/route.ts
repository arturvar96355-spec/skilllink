import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/data-quality/data-quality.service'
import { dismissDuplicateSchema } from '@/modules/data-quality/data-quality.schema'

/** Отметить пару «не дубль»: поиск больше её не предлагает (решение 134). */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const input = await parseBody(request, dismissDuplicateSchema)
  return ok(await service.dismiss(user, input))
})
