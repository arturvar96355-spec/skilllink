import { getCurrentUser } from '@/shared/auth/current-user'
import { clientAddress } from '@/shared/auth/throttle'
import { handle } from '@/shared/http'
import * as service from '@/modules/dsar/dsar.service'
import { dsarFileResponse } from '@/modules/dsar/dsar.http'

/**
 * «Мои данные»: пользователь выгружает всё, что система знает о нём (ст. 14 152-ФЗ,
 * решение 116). Любая роль, только о себе; не чаще раза в 10 минут — иначе 409.
 */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const result = await service.exportOwnData(user, { address: clientAddress(request.headers) })
  return dsarFileResponse(result)
})
