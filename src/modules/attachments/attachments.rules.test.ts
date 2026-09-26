import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import { MAX_ATTACHMENT_SIZE_BYTES } from '@/shared/config/attachments.config'
import type { UploadedFile } from '@/shared/http/request'
import { assertValidAttachment, attachmentTooLarge } from './attachments.rules'

function file(name: string, bytes: number[], type = 'application/octet-stream'): UploadedFile {
  const array = new Uint8Array(bytes)
  return { name, type, size: array.length, bytes: array }
}

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]

describe('проверка загруженного файла (решение 145, ТЗ функц. п.3)', () => {
  it('настоящий png с расширением .png проходит', () => {
    expect(assertValidAttachment(file('фото.png', PNG_BYTES))).toBe('png')
  })

  it('запрещённое расширение — 422 с перечнем разрешённых форматов', () => {
    try {
      assertValidAttachment(file('вирус.exe', PNG_BYTES))
      throw new Error('ожидалась ошибка')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('VALIDATION_ERROR')
      expect(JSON.stringify((error as AppError).details)).toContain('png, jpeg, pdf')
    }
  })

  it('подмена расширения: текстовый файл переименован в .png — 422', () => {
    const textBytes = [...new TextEncoder().encode('это не png, просто текст')]
    try {
      assertValidAttachment(file('фото.png', textBytes))
      throw new Error('ожидалась ошибка')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('VALIDATION_ERROR')
      expect((error as AppError).message).toBe('Содержимое файла не соответствует расширению')
    }
  })

  it('файл без расширения — недопустимый формат', () => {
    expect(() => assertValidAttachment(file('файл_без_расширения', PNG_BYTES))).toThrowError(AppError)
  })
})

describe('размер файла (решение 145)', () => {
  it('attachmentTooLarge — ошибка валидации с пределом в мегабайтах', () => {
    const error = attachmentTooLarge()
    expect(error.code).toBe('VALIDATION_ERROR')
    const megabytes = Math.floor(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024))
    expect(JSON.stringify(error.details)).toContain(String(megabytes))
  })
})
