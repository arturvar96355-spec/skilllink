import { describe, expect, it } from 'vitest'
import { readStoredTheme, resolveTheme, writeTheme, type ThemeStorage } from './theme'

function memory(initial: Record<string, string> = {}): ThemeStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

const broken: ThemeStorage = {
  getItem: () => {
    throw new Error('заблокировано')
  },
  setItem: () => {
    throw new Error('заблокировано')
  },
}

describe('тема интерфейса', () => {
  it('без выбора человека следует системе', () => {
    expect(resolveTheme(null, true)).toBe('light')
    expect(resolveTheme(null, false)).toBe('dark')
  })

  it('выбор человека главнее системы', () => {
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('light', false)).toBe('light')
  })

  it('читает только известные значения', () => {
    expect(readStoredTheme(memory({ 'skilllink.theme': 'light' }))).toBe('light')
    expect(readStoredTheme(memory({ 'skilllink.theme': 'sepia' }))).toBeNull()
    expect(readStoredTheme(null)).toBeNull()
  })

  it('сбой хранилища не ломает страницу', () => {
    expect(readStoredTheme(broken)).toBeNull()
    expect(writeTheme(broken, 'light')).toBe(false)
  })

  it('запоминает выбор', () => {
    const storage = memory()
    expect(writeTheme(storage, 'light')).toBe(true)
    expect(readStoredTheme(storage)).toBe('light')
  })
})
