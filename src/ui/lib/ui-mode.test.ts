import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UI_MODE,
  UI_MODE_BOOT_SCRIPT,
  UI_MODE_KEY,
  parseUiMode,
  readUiMode,
  writeUiMode,
  type UiModeStorage,
} from './ui-mode'

/** Хранилище в памяти — как localStorage, только без браузера. */
function memoryStorage(initial: Record<string, string> = {}): UiModeStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => (key in data ? data[key]! : null),
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

/** Хранилище, которое бросает исключение, как в приватном окне Safari. */
const brokenStorage: UiModeStorage = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

describe('режим интерфейса', () => {
  it('по умолчанию — презентационный (решение 211)', () => {
    expect(DEFAULT_UI_MODE).toBe('showcase')
    expect(readUiMode(memoryStorage())).toBe('showcase')
    expect(readUiMode(null)).toBe('showcase')
    expect(readUiMode(undefined)).toBe('showcase')
  })

  it('выбор, сделанный под прежним ключом, не действует — умолчание у всех', () => {
    expect(UI_MODE_KEY).not.toBe('skilllink.uiMode')
    expect(readUiMode(memoryStorage({ 'skilllink.uiMode': 'work' }))).toBe('showcase')
  })

  it('неизвестное значение — режим по умолчанию', () => {
    expect(parseUiMode('showcase')).toBe('showcase')
    expect(parseUiMode('work')).toBe('work')
    expect(parseUiMode('Work')).toBe('showcase')
    expect(parseUiMode('')).toBe('showcase')
    expect(parseUiMode(null)).toBe('showcase')
    expect(readUiMode(memoryStorage({ [UI_MODE_KEY]: 'cards' }))).toBe('showcase')
  })

  it('запомненный режим читается обратно', () => {
    const storage = memoryStorage()
    expect(writeUiMode(storage, 'showcase')).toBe(true)
    expect(storage.data[UI_MODE_KEY]).toBe('showcase')
    expect(readUiMode(storage)).toBe('showcase')

    expect(writeUiMode(storage, 'work')).toBe(true)
    expect(readUiMode(storage)).toBe('work')
  })

  it('сбой хранилища не ломает страницу', () => {
    expect(() => readUiMode(brokenStorage)).not.toThrow()
    expect(readUiMode(brokenStorage)).toBe('showcase')
    expect(() => writeUiMode(brokenStorage, 'showcase')).not.toThrow()
    expect(writeUiMode(brokenStorage, 'showcase')).toBe(false)
    expect(writeUiMode(null, 'showcase')).toBe(false)
  })

  describe('скрипт до первой отрисовки', () => {
    /** Выполнить встроенный скрипт с подложенными localStorage и <html>. */
    function runBoot(localStorage: UiModeStorage): string | null {
      const attributes: Record<string, string> = {}
      const document = { documentElement: { setAttribute: (name: string, value: string) => (attributes[name] = value) } }
      new Function('localStorage', 'document', UI_MODE_BOOT_SCRIPT)(localStorage, document)
      return attributes['data-mode'] ?? null
    }

    it('ставит на <html> тот же режим, что и readUiMode', () => {
      expect(runBoot(memoryStorage())).toBe('showcase')
      expect(runBoot(memoryStorage({ [UI_MODE_KEY]: 'work' }))).toBe('work')
      expect(runBoot(memoryStorage({ [UI_MODE_KEY]: 'мусор' }))).toBe('showcase')
    })

    it('ставит режим по умолчанию, даже если хранилище недоступно', () => {
      expect(runBoot(brokenStorage)).toBe('showcase')
    })
  })
})
