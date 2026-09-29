import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXTRA_PRODUCTS } from './demo/catalog'
import { SCHOOL_PRODUCT_VENDORS, SEED_VENDOR_NAMES } from './seed-vendors'

/**
 * Решение 235: у продуктов ИТ-Школы, по которым идут связки, есть вендор — иначе в
 * «Вендорах» у всех «Связок: 0». Сопоставление держится на названиях: проверяем, что
 * каждое название продукта и вендора действительно заводит сид.
 */
describe('вендоры продуктов ИТ-Школы в демо-наборе', () => {
  const seedSource = readFileSync(new URL('./seed.ts', import.meta.url), 'utf8')
  const extraNames = new Set(EXTRA_PRODUCTS.map((product) => product.name))

  it('каждый продукт из сопоставления заводит основной сид или расширенный набор', () => {
    for (const name of Object.keys(SCHOOL_PRODUCT_VENDORS)) {
      const inBaseSeed = seedSource.includes(`name: '${name}'`)
      expect(inBaseSeed || extraNames.has(name), name).toBe(true)
    }
  })

  it('все продукты расширенного набора получили вендора', () => {
    for (const name of extraNames) expect(SCHOOL_PRODUCT_VENDORS[name], name).toBeDefined()
  })

  it('каждый вендор из сопоставления есть в демо-наборе, и у каждого вендора есть продукт со связками', () => {
    const used = new Set(Object.values(SCHOOL_PRODUCT_VENDORS))
    for (const vendor of used) expect(SEED_VENDOR_NAMES).toContain(vendor)
    for (const vendor of SEED_VENDOR_NAMES) expect(used.has(vendor), vendor).toBe(true)
  })
})
