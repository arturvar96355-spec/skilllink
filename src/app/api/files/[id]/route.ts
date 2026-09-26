import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import { contentDisposition } from '@/shared/files/attachment-storage'
import * as service from '@/modules/attachments/attachments.service'

type Context = { params: Promise<{ id: string }> }

/**
 * Скачивание файла (решение 145). `no-store`: файлы бывают персональными данными
 * (сканы паспорта, договор с ФИО) — их не место в кэше браузера или прокси.
 * Имя в `Content-Disposition` — безопасное (без CRLF- и заголовок-инъекций),
 * но исходное: пользователь видит тот же файл, что загружал.
 */
export const GET = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const { attachment, bytes } = await service.download(user, id)

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': attachment.mime || 'application/octet-stream',
      'content-length': String(attachment.size),
      'content-disposition': contentDisposition(attachment.originalName),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
})

/** Удаление файла. Право — как у удаления/правки самого владельца (документа/этапа). */
export const DELETE = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.remove(user, id))
})
