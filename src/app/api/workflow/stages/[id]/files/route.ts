import { getCurrentUser } from '@/shared/auth/current-user'
import { created, handle, ok, parseSingleFileUpload } from '@/shared/http'
import * as service from '@/modules/attachments/attachments.service'
import { attachmentTooLarge } from '@/modules/attachments/attachments.rules'
import { MAX_ATTACHMENT_SIZE_BYTES } from '@/shared/config/attachments.config'

type Context = { params: Promise<{ id: string }> }

/** Файлы этапа (решение 145, ТЗ функц. требования п.3). Право — как у `PATCH /api/workflow/stages/:id`. */
export const GET = handle<Context>(async (_request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  return ok(await service.list(user, 'STAGE', id))
})

/** Загрузка файла к этапу. Тело — `multipart/form-data`, поле `file`. */
export const POST = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const file = await parseSingleFileUpload(request, { maxBytes: MAX_ATTACHMENT_SIZE_BYTES, tooLarge: attachmentTooLarge })
  return created(await service.upload(user, 'STAGE', id, file))
})
