import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, parseQuery } from '@/shared/http'
import { contentDisposition } from '@/shared/http/content-disposition'
import * as service from '@/modules/documents/documents.service'
import { documentFileQuerySchema } from '@/modules/documents/documents.schema'

type Context = { params: Promise<{ id: string }> }

/**
 * Файл документа (решение 212, п. 2): HTML-страница с реквизитами, текстом,
 * ссылкой на оригинал, списком файлов и историей статусов. Работает в любом
 * статусе документа и связки — закрытие запрещает правку, а не чтение.
 *
 * `?download=1` — скачать (`attachment`), без него — открыть в браузере (`inline`).
 * Скриптов в файле нет; политика безопасности ответа — в next.config.ts.
 */
export const GET = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const { download } = parseQuery(request, documentFileQuerySchema)
  const file = await service.documentFile(user, id)

  return new Response(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      'content-type': file.mime,
      'content-length': String(file.bytes.length),
      'content-disposition': contentDisposition(file.name, download === '1' ? 'attachment' : 'inline'),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
})
