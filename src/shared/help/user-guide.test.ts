import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HELP_SECTIONS } from './index'
import { renderUserGuide } from './markdown'

/**
 * docs/USER_GUIDE.md собирается из реестра (решение 214). Поменяли текст в
 * src/shared/help и забыли пересобрать — тест падает, и файл для платформы
 * конкурса не разойдётся с тем, что на сайте.
 */
describe('docs/USER_GUIDE.md', () => {
  const file = readFileSync(join(process.cwd(), 'docs', 'USER_GUIDE.md'), 'utf8')

  it('совпадает с реестром — иначе запустите npm run docs:user-guide', () => {
    expect(file === renderUserGuide(), 'docs/USER_GUIDE.md устарел: npm run docs:user-guide').toBe(true)
  })

  it('содержит каждый раздел с якорем', () => {
    for (const section of HELP_SECTIONS) {
      expect(file).toContain(`<a id="${section.id}"></a>`)
      expect(file).toContain(`### ${section.title}`)
    }
  })
})
