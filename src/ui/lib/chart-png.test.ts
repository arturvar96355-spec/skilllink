import { describe, expect, it } from 'vitest'
import { PNG_CAPTURE_ATTRIBUTE, chartFileName, withLightTheme } from './chart-png'

describe('имя файла диаграммы', () => {
  const day = new Date(2026, 8, 28)

  it('латиницей, с датой: skilllink-<название>-<дата>.png', () => {
    expect(chartFileName('Связки по вузам', day)).toBe('skilllink-svyazki-po-vuzam-2026-09-28.png')
  })

  it('знаки и лишние дефисы убираются, пустое название — «diagramma»', () => {
    expect(chartFileName('Воронка: «этапы» (все)', day)).toBe('skilllink-voronka-etapy-vse-2026-09-28.png')
    expect(chartFileName('…', day)).toBe('skilllink-diagramma-2026-09-28.png')
  })
})

/** Корень страницы без браузера: только атрибуты и принудительный пересчёт. */
function fakeRoot(theme: string | null) {
  const attributes = new Map<string, string>()
  if (theme !== null) attributes.set('data-theme', theme)
  let reflows = 0
  const root = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
    getBoundingClientRect: () => {
      reflows += 1
      return {}
    },
  }
  return { root: root as unknown as HTMLElement, attributes, reflows: () => reflows }
}

describe('картинка диаграммы — всегда в светлой теме (решение 232)', () => {
  it('в тёмной теме стили читаются при светлой, переходы выключены; потом тема возвращается', () => {
    const page = fakeRoot('dark')
    const seen = withLightTheme(
      () => [page.attributes.get('data-theme'), page.attributes.has(PNG_CAPTURE_ATTRIBUTE)],
      page.root,
    )
    expect(seen).toEqual(['light', true])
    expect(page.attributes.get('data-theme')).toBe('dark')
    expect(page.attributes.has(PNG_CAPTURE_ATTRIBUTE)).toBe(false)
    // Стили пересчитаны до включения переходов — цвета не «перетекают» назад на глазах.
    expect(page.reflows()).toBe(1)
  })

  it('тема по умолчанию (без атрибута) — атрибут снова снят', () => {
    const page = fakeRoot(null)
    withLightTheme(() => undefined, page.root)
    expect(page.attributes.has('data-theme')).toBe(false)
  })

  it('в светлой теме ничего не переключается', () => {
    const page = fakeRoot('light')
    withLightTheme(() => undefined, page.root)
    expect(page.attributes.get('data-theme')).toBe('light')
    expect(page.reflows()).toBe(0)
  })

  it('сбой при чтении не оставляет страницу светлой', () => {
    const page = fakeRoot('dark')
    expect(() =>
      withLightTheme(() => {
        throw new Error('сбой')
      }, page.root),
    ).toThrow('сбой')
    expect(page.attributes.get('data-theme')).toBe('dark')
    expect(page.attributes.has(PNG_CAPTURE_ATTRIBUTE)).toBe(false)
  })
})
