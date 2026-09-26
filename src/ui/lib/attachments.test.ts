import { describe, expect, it } from 'vitest'
import { ATTACHMENT_ALLOWED_EXTENSIONS, MAX_ATTACHMENT_SIZE_BYTES } from '@/shared/config/attachments.config'
import { ATTACHMENT_ACCEPT, ATTACHMENT_EXTENSIONS, MAX_ATTACHMENT_MB } from './attachments'

/**
 * Список форматов и предел размера в интерфейсе (решение 149) задублированы
 * из серверного `attachments.config.ts` (см. комментарий там же, почему —
 * `node:path` в клиентский бандл не идёт). Если ТЗ или сервер поменяют
 * список форматов или предел, этот тест сломается раньше, чем расхождение
 * заметит живой пользователь.
 */
describe('список форматов интерфейса совпадает с серверным', () => {
  it('те же расширения, что ATTACHMENT_ALLOWED_EXTENSIONS', () => {
    expect([...ATTACHMENT_EXTENSIONS].sort()).toEqual([...ATTACHMENT_ALLOWED_EXTENSIONS].sort())
  })

  it('accept для <input type="file"> — точка перед каждым расширением, без пробелов', () => {
    for (const extension of ATTACHMENT_EXTENSIONS) {
      expect(ATTACHMENT_ACCEPT).toContain(`.${extension}`)
    }
    expect(ATTACHMENT_ACCEPT).not.toContain(' ')
  })
})

describe('подсказка о пределе размера', () => {
  it('совпадает с MAX_ATTACHMENT_SIZE_BYTES сервера', () => {
    expect(MAX_ATTACHMENT_MB).toBe(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024))
  })
})
