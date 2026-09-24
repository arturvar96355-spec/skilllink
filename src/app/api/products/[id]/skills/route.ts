import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/products/products.service'
import { setProductSkillsSchema } from '@/modules/products/products.schema'

type Context = { params: Promise<{ id: string }> }

/** Полная замена набора навыков продукта. */
export const PUT = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, setProductSkillsSchema)
  return ok(await service.setSkills(user, id, input))
})
