import { describe, expect, it } from 'vitest'
import { safeReturnPath } from './return-path'

describe('адрес возврата после входа', () => {
  it('путь внутри сайта сохраняется вместе с параметрами', () => {
    expect(safeReturnPath('/cooperations/abc?stage=s6#tasks')).toBe('/cooperations/abc?stage=s6#tasks')
    expect(safeReturnPath('/')).toBe('/')
  })

  it('нет адреса — главная', () => {
    expect(safeReturnPath(null)).toBe('/')
    expect(safeReturnPath('')).toBe('/')
  })

  it.each([
    '//evil.example',
    '//evil.example/login',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    'evil.example',
  ])('чужой сайт не пропускается: %j', (from) => {
    expect(safeReturnPath(from)).toBe('/')
  })
})
