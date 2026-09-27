import { describe, expect, it } from 'vitest'
import { HEAD_GAP, HEAD_RADIUS, HEAD_SWAY, placeHead, type Box } from './comet-head'

/** Строка знака и его подпись, как их меряет экран входа (промышленная сборка, решение 208). */
function brandAt(top: number, left = 77): { brand: Box; text: Box } {
  return {
    brand: { left, top, right: left + 517, bottom: top + 55 },
    text: { left: left + 46, top: top + 2, right: left + 176, bottom: top + 53 },
  }
}

/** Нижний край свечения головы в худшем покачивании сцены. */
function glowBottom(y: number, scale: number, height: number): number {
  return y + HEAD_RADIUS * height * scale + HEAD_SWAY * (height / 2 - y)
}

describe('placeHead — голова кометы и знак SkillLink', () => {
  it('в высоком окне — как было: на 150 px выше знака, не ближе 96 px к краю', () => {
    const { brand, text } = brandAt(346, 80)
    expect(placeHead(brand, text, 1920, 1080)).toEqual({ x: 128, y: 196, scale: 1 })
    const mid = brandAt(181, 80)
    expect(placeHead(mid.brand, mid.text, 1440, 750)).toEqual({ x: 128, y: 96, scale: 1 })
  })

  it.each([
    [1280, 570, 91],
    [1280, 620, 116],
    [1366, 618, 115],
    [1440, 750, 181],
    [1920, 1080, 346],
  ])('%i×%i: свечение головы выше строки знака с зазором, голова в окне', (width, height, top) => {
    const { brand, text } = brandAt(top)
    const head = placeHead(brand, text, width, height)
    expect(glowBottom(head.y, head.scale, height)).toBeLessThanOrEqual(brand.top - HEAD_GAP + 1)
    expect(head.y - HEAD_RADIUS * height * head.scale).toBeGreaterThan(0)
  })

  it('мало места — голова сжимается, а не опускается на знак', () => {
    // 1280×720 с панелями браузера: видно 570 px, строка знака — на 91 px от верха.
    const { brand, text } = brandAt(91)
    const head = placeHead(brand, text, 1280, 570)
    expect(head.scale).toBeLessThan(1)
    expect(head.scale).toBeGreaterThanOrEqual(0.55)
    expect(glowBottom(head.y, head.scale, 570)).toBeLessThanOrEqual(brand.top - HEAD_GAP + 1)
  })

  it('места над знаком нет вовсе — голова правее подписи знака, не на нём', () => {
    const { brand, text } = brandAt(24)
    const head = placeHead(brand, text, 1280, 480)
    expect(head.scale).toBe(0.55)
    const radius = HEAD_RADIUS * 480 * head.scale
    expect(head.x - radius - HEAD_SWAY * (1280 / 2 - head.x)).toBeGreaterThanOrEqual(text.right + HEAD_GAP - 1)
    expect(head.y).toBeGreaterThan(brand.top)
    expect(head.y).toBeLessThan(brand.bottom)
  })
})
