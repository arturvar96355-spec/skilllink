import { getCurrentUser } from '@/shared/auth/current-user'
import { handle } from '@/shared/http'
import * as service from '@/modules/dsar/dsar.service'
import { dsarFileResponse } from '@/modules/dsar/dsar.http'

type Context = { params: Promise<{ id: string }> }

/**
 * «Всё о субъекте»: выгрузка сведений о контактном лице вуза по ст. 14 152-ФЗ
 * (решение 116). Только ADMIN. Закрывает открытый запрос субъекта на сведения.
 */
export const GET = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return dsarFileResponse(await service.exportSubject(user, 'CONTACT', id))
})
