import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_ALLOWED_EXTENSIONS,
  ATTACHMENT_SIGNATURES,
  extensionOf,
  isAllowedExtension,
  matchesSignature,
  mimeForExtension,
} from './attachments.config'

/**
 * Форматы файлов из ТЗ (решение 145): расширение и сигнатура (magic bytes).
 * Список расширений — дословно из задания, без добавлений.
 */
describe('расширение из имени файла', () => {
  it('берёт хвост после последней точки, в нижнем регистре', () => {
    expect(extensionOf('Договор.PDF')).toBe('pdf')
    expect(extensionOf('архив.tar.gz')).toBe('gz')
  })

  it('без точки или точка в конце — пустая строка', () => {
    expect(extensionOf('файл')).toBe('')
    expect(extensionOf('файл.')).toBe('')
  })
})

describe('список расширений — ровно из ТЗ', () => {
  it('содержит эти десять форматов и ничего сверх них', () => {
    expect([...ATTACHMENT_ALLOWED_EXTENSIONS].sort()).toEqual(
      ['doc', 'docx', 'gzip', 'jpeg', 'pdf', 'png', 'rar', 'xls', 'xlsx', 'zip'].sort(),
    )
  })

  it('«jpg» не входит: в ТЗ дословно только «jpeg»', () => {
    expect(isAllowedExtension('jpg')).toBe(false)
  })

  it('exe, php, sh — не входят', () => {
    expect(isAllowedExtension('exe')).toBe(false)
    expect(isAllowedExtension('php')).toBe(false)
    expect(isAllowedExtension('sh')).toBe(false)
  })
})

describe('сигнатура задана для каждого разрешённого расширения', () => {
  it('в ATTACHMENT_SIGNATURES есть непустой список для каждого расширения', () => {
    for (const extension of ATTACHMENT_ALLOWED_EXTENSIONS) {
      expect(ATTACHMENT_SIGNATURES[extension]?.length ?? 0, extension).toBeGreaterThan(0)
    }
  })
})

describe('проверка сигнатуры (magic bytes)', () => {
  const cases: Array<{ extension: (typeof ATTACHMENT_ALLOWED_EXTENSIONS)[number]; bytes: number[] }> = [
    { extension: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0] },
    { extension: 'jpeg', bytes: [0xff, 0xd8, 0xff, 0xe0, 0, 0] },
    { extension: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34] },
    { extension: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04, 0, 0] },
    { extension: 'docx', bytes: [0x50, 0x4b, 0x03, 0x04, 0, 0] },
    { extension: 'xlsx', bytes: [0x50, 0x4b, 0x05, 0x06, 0, 0] },
    { extension: 'gzip', bytes: [0x1f, 0x8b, 0x08, 0, 0] },
    { extension: 'rar', bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00] },
    { extension: 'rar', bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00] },
    { extension: 'doc', bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
    { extension: 'xls', bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  ]

  for (const { extension, bytes } of cases) {
    it(`${extension}: настоящее содержимое проходит проверку`, () => {
      expect(matchesSignature(extension, new Uint8Array(bytes))).toBe(true)
    })
  }

  it('подмена расширения: текстовый файл с расширением .png сигнатуру не проходит', () => {
    const textBytes = new TextEncoder().encode('это не картинка, а обычный текст')
    expect(matchesSignature('png', textBytes)).toBe(false)
  })

  it('подмена расширения: содержимое zip с расширением .pdf сигнатуру не проходит', () => {
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])
    expect(matchesSignature('pdf', zipBytes)).toBe(false)
  })

  it('содержимое короче сигнатуры не проходит (не бросает, просто false)', () => {
    expect(matchesSignature('png', new Uint8Array([0x89, 0x50]))).toBe(false)
  })
})

/**
 * Content-Type при скачивании — по расширению, которое уже проверено сигнатурой,
 * а не по тому, что прислал браузер клиента (решение 173, жёсткое ревью, проблема 16).
 */
describe('Content-Type по расширению — для каждого разрешённого формата', () => {
  it('у каждого расширения из ТЗ есть непустой MIME-тип', () => {
    for (const extension of ATTACHMENT_ALLOWED_EXTENSIONS) {
      expect(mimeForExtension(extension), extension).toMatch(/\//)
    }
  })

  it('несколько конкретных значений, чтобы регресс было видно построчно', () => {
    expect(mimeForExtension('png')).toBe('image/png')
    expect(mimeForExtension('pdf')).toBe('application/pdf')
    expect(mimeForExtension('zip')).toBe('application/zip')
    expect(mimeForExtension('docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  })
})
