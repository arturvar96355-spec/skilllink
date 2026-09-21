import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody, parseQuery } from '@/shared/http'
import * as service from '@/modules/products/products.service'
import {
  releasePreviewQuerySchema,
  releaseProductVersionSchema,
} from '@/modules/products/products.schema'

type Context = { params: Promise<{ id: string }> }

/**
 * Предпросмотр групповой операции: какие связки затронет выпуск версии.
 * Ничего не меняет — менеджер видит список до нажатия кнопки.
 */
export const GET = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const { version } = parseQuery(request, releasePreviewQuerySchema)
  return ok(await service.previewRelease(user, id, version))
})

/**
 * Выпуск новой версии продукта: одно действие ставит задачи во всех связках,
 * где передана устаревшая версия, и переоткрывает закрытые этапы материалов.
 */
export const POST = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseBody(request, releaseProductVersionSchema)
  return ok(await service.releaseVersion(user, id, input))
})
