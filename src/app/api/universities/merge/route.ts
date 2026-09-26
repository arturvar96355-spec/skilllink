import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/universities/merge.service'
import { mergeUniversitiesSchema } from '@/modules/universities/merge.schema'

/** Слить вуз-дубль в другой одной транзакцией (только администратор, решение 134). */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const input = await parseBody(request, mergeUniversitiesSchema)
  return ok(await service.merge(user, input))
})
