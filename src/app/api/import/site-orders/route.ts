import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseQuery, readBodyBytes } from '@/shared/http'
import { validationError } from '@/shared/http/errors'
import * as service from '@/modules/enrollment/enrollment.service'
import { siteOrdersQuerySchema } from '@/modules/enrollment/enrollment.schema'

/** Больше этого тело не читаем: 2000 заказов по ~300 байт — меньше мегабайта. */
const MAX_ORDERS_BODY_BYTES = 2 * 1024 * 1024

/**
 * Загрузка заказов с сайта (решение 122). Тело — JSON-массив заказов, как выгружает сайт.
 * По умолчанию предпросмотр с отчётом о качестве данных, запись — `mode=apply`.
 * В ответе и в базе нет ни ФИО, ни почты, ни телефона слушателей.
 */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  service.assertCanImportOrders(user)
  const query = parseQuery(request, siteOrdersQuerySchema)
  const bytes = await readBodyBytes(request, MAX_ORDERS_BODY_BYTES, () =>
    validationError('Файл слишком большой', [
      { field: 'file', message: `Допустимо не больше ${MAX_ORDERS_BODY_BYTES / 1024 / 1024} МБ` },
    ]),
  )
  return ok(await service.importSiteOrders(user, query, service.parseOrdersBody(bytes)))
})
