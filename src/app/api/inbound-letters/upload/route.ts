import { getCurrentUser } from '@/shared/auth/current-user'
import { created, handle, parseSingleFileUpload } from '@/shared/http'
import * as service from '@/modules/inbound-letters/inbound-letters.service'
import { letterFileTooLarge } from '@/modules/inbound-letters/inbound-letters.rules'
import { MAX_EML_SIZE_BYTES } from '@/shared/config/inbound-letters.config'

/**
 * Загрузка письма вуза (решение 170). Тело — `multipart/form-data`, поле `file`
 * с файлом `.eml`. Создаёт обращение и сразу разбирает его (код, и если подключена
 * модель — она); ответ — уже разобранная карточка письма.
 */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const file = await parseSingleFileUpload(request, { maxBytes: MAX_EML_SIZE_BYTES, tooLarge: letterFileTooLarge })
  return created(await service.uploadEml(user, file))
})
