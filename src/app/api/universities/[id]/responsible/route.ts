import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/universities/universities.service'
import { setUniversityResponsibleSchema } from '@/modules/universities/universities.schema'

type Context = { params: Promise<{ id: string }> }

/**
 * Назначить, сменить или снять ответственного за вуз (ТЗ — роль «Руководитель»,
 * решение 146). Только право ASSIGN_RESPONSIBLE (роли ADMIN, HEAD).
 * `{ responsibleId: string | null }` — null снимает ответственного.
 */
export const PATCH = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, setUniversityResponsibleSchema)
  return ok(await service.setResponsible(user, id, input))
})
