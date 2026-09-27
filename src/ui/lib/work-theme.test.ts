import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORK_THEME,
  WORK_THEME_BOOT_SCRIPT,
  WORK_THEME_PREVIEW_KEY,
  parseWorkTheme,
} from './work-theme'

/** Исполнить скрипт до отрисовки в подделке браузера и вернуть атрибут на <html>. */
function runBoot(stored: string | null, broken = false): string | null {
  const attrs: Record<string, string> = {}
  const localStorage = {
    getItem: (key: string) => {
      if (broken) throw new Error('SecurityError')
      return key === WORK_THEME_PREVIEW_KEY ? stored : null
    },
  }
  const document = { documentElement: { setAttribute: (name: string, value: string) => (attrs[name] = value) } }
  new Function('localStorage', 'document', WORK_THEME_BOOT_SCRIPT)(localStorage, document)
  return attrs['data-work-theme'] ?? null
}

describe('спокойный вид рабочего режима', () => {
  it('известные варианты читаются, неизвестное — умолчание', () => {
    expect(parseWorkTheme('a')).toBe('a')
    expect(parseWorkTheme('b')).toBe('b')
    expect(parseWorkTheme('c')).toBe('c')
    expect(parseWorkTheme('off')).toBeNull()
    expect(parseWorkTheme('z')).toBe(DEFAULT_WORK_THEME)
    expect(parseWorkTheme(null)).toBe(DEFAULT_WORK_THEME)
  })

  it('скрипт ставит вариант из предпросмотра', () => {
    expect(runBoot('b')).toBe('b')
    expect(runBoot('c')).toBe('c')
  })

  it('без предпросмотра и при сбое хранилища — умолчание', () => {
    expect(runBoot(null)).toBe(DEFAULT_WORK_THEME)
    expect(runBoot(null, true)).toBe(DEFAULT_WORK_THEME)
    expect(runBoot('off')).toBeNull()
  })
})
