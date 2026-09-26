import { validationError } from '@/shared/http/errors'
import type { UploadedFile } from '@/shared/http/request'
import {
  ATTACHMENT_ALLOWED_EXTENSIONS,
  MAX_ATTACHMENT_SIZE_BYTES,
  extensionOf,
  isAllowedExtension,
  matchesSignature,
  type AttachmentExtension,
} from '@/shared/config/attachments.config'

/** Ответ 422 на файл больше предела — общий текст для проверки Content-Length и после разбора формы. */
export function attachmentTooLarge() {
  const megabytes = Math.floor(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024))
  return validationError('Файл слишком большой', [
    { field: 'file', message: `Допустимо не больше ${megabytes} МБ` },
  ])
}

/**
 * Проверка загруженного файла (ТЗ функц. требования п.3, решение 145): расширение —
 * ровно из списка ТЗ, и содержимое подтверждает расширение сигнатурой (magic bytes).
 * Первой проверки мало: файл `.exe`, переименованный в `.png`, расширение бы прошёл.
 */
export function assertValidAttachment(file: UploadedFile): AttachmentExtension {
  const extension = extensionOf(file.name)
  if (!isAllowedExtension(extension)) {
    throw validationError('Недопустимый формат файла', [
      {
        field: 'file',
        message: `Разрешены форматы: ${ATTACHMENT_ALLOWED_EXTENSIONS.join(', ')}`,
      },
    ])
  }
  if (!matchesSignature(extension, file.bytes)) {
    throw validationError('Содержимое файла не соответствует расширению', [
      {
        field: 'file',
        message: 'Проверка сигнатуры файла (magic bytes) не пройдена — похоже, расширение подменено',
      },
    ])
  }
  return extension
}
