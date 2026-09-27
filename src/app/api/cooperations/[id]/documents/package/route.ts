import { getCurrentUser } from '@/shared/auth/current-user'
import { handle } from '@/shared/http'
import { contentDisposition } from '@/shared/http/content-disposition'
import * as service from '@/modules/documents/documents.service'

type Context = { params: Promise<{ id: string }> }

/**
 * Пакет документов связки одним ZIP-архивом (решение 212, п. 2): по папке на
 * документ — файл документа и приложенные файлы. Все статусы документов,
 * любой статус связки: завершённая связка скачивается так же, как идущая.
 */
export const GET = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const file = await service.documentPackage(user, id)

  // Представление поверх того же буфера, без копии: архив бывает до 100 МБ (решение 222).
  return new Response(new Uint8Array(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength), {
    status: 200,
    headers: {
      'content-type': file.mime,
      'content-length': String(file.bytes.length),
      'content-disposition': contentDisposition(file.name),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
})
