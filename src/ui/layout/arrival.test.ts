import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ARRIVAL_PARTS, ASSEMBLED_ATTRIBUTE, arrivalAfterNavigation, markAssembled } from './arrival'

/**
 * Сцена входа играет один раз (решение 194): не повторяется ни при возвращении
 * на страницу, ни при догрузке данных рядом с уже собранным блоком.
 */
describe('сцена входа', () => {
  it('держится, пока человек на странице, куда пришёл со входа', () => {
    expect(arrivalAfterNavigation('/', '/')).toBe('/')
  })

  it('кончается насовсем, когда человек уходит, — возвращение её не включает', () => {
    let arrivedAt: string | null = '/'
    for (const pathname of ['/universities', '/']) {
      arrivedAt = arrivalAfterNavigation(arrivedAt, pathname)
    }
    expect(arrivedAt).toBeNull()
  })

  it('без входа сцены нет', () => {
    expect(arrivalAfterNavigation(null, '/')).toBeNull()
  })
})

function fakeElement(matchingSelector: string | null) {
  const attributes = new Map<string, string>()
  return {
    attributes,
    matches: (selector: string) => selector === matchingSelector,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  }
}

describe('отметка собравшейся части', () => {
  it('ставится на часть сцены, чья анимация закончилась', () => {
    const block = fakeElement(ARRIVAL_PARTS)
    expect(markAssembled(block)).toBe(true)
    expect(block.attributes.has(ASSEMBLED_ATTRIBUTE)).toBe(true)
  })

  it('не ставится на внутренние элементы блока — у них своё движение', () => {
    const inner = fakeElement(null)
    expect(markAssembled(inner)).toBe(false)
    expect(inner.attributes.size).toBe(0)
  })

  it('пропускает цель без DOM', () => {
    expect(markAssembled(null)).toBe(false)
    expect(markAssembled({})).toBe(false)
  })
})

describe('правила сборки в Shell.module.css', () => {
  const css = readFileSync(fileURLToPath(new URL('./Shell.module.css', import.meta.url)), 'utf8')

  it('пока звёзды ждут страницу, сборка стоит на старте', () => {
    expect(css).toMatch(
      /:global\(body\[data-star-assembly='pending'\]\) \.arrival :is\(aside, header, \.page > \*, \[data-assemble\]\) \{\s*animation-play-state: paused;/,
    )
  })

  it('собравшаяся и собранная звёздами часть выходит из сборки и перебивает правило блоков страницы', () => {
    const blockRule = css.indexOf('.arrival .page > :not(:has([data-assemble]))')
    const noneRule = css.search(/\.arrival \.page > \[data-assembled\] \{\s*animation: none;/)
    expect(blockRule).toBeGreaterThan(-1)
    expect(noneRule).toBeGreaterThan(blockRule)
    expect(css).toContain('.arrival .page > [data-star-claimed],')
  })
})
