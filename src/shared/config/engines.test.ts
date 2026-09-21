import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Требование к версии Node живёт в package.json, но человек читает README.
 * Разойдутся — и тот, кто следует README, поставит версию, на которой
 * Prisma не запустится.
 */
describe('требование к версии Node', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    engines?: { node?: string }
  }
  const required = pkg.engines?.node ?? ''

  it('задано в package.json', () => {
    expect(required, 'без engines npm не предупредит о неподходящей версии').not.toBe('')
  })

  it('запрещает версии, на которых Prisma 7 не работает', () => {
    // Дыры между ветками: 20.0–20.18, вся 21, 22.0–22.11.
    expect(required).toContain('20.19')
    expect(required).toContain('22.12')
  })

  it('установка останавливается, а не предупреждает', () => {
    const npmrc = readFileSync(join(process.cwd(), '.npmrc'), 'utf8')
    expect(
      npmrc.includes('engine-strict=true'),
      'без engine-strict npm лишь напишет предупреждение в поток вывода',
    ).toBe(true)
  })

  for (const file of ['README.md', 'docs/TASK_FRONTEND.md']) {
    it(`${file} называет те же версии`, () => {
      const text = readFileSync(join(process.cwd(), file), 'utf8')
      expect(
        text.includes('20.19') && text.includes('22.12'),
        `${file} обязан повторять требование из package.json: человек читает его, а не engines`,
      ).toBe(true)
    })
  }
})
