import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseOptionalBody } from '@/shared/http'
import * as service from '@/modules/documents/documents.service'
import { generateDocumentsSchema } from '@/modules/documents/documents.schema'

type Context = { params: Promise<{ id: string }> }

/**
 * Собирает пакет документов по связке с автоподстановкой реквизитов (концепция).
 * Недостающие реквизиты заменяются видимым прочерком и перечисляются в ответе.
 */
export const POST = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseOptionalBody(request, generateDocumentsSchema)
  return ok(await service.generatePackage(user, id, input))
})
