import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HELP_TERMS, HELP_TOPICS, termsFor, topicsFor } from './help-content'

const APP_DIR = join(process.cwd(), 'src', 'app', '(app)')

describe('справка', () => {
  it('ссылки из карточек ведут на существующие страницы', () => {
    for (const topic of HELP_TOPICS) {
      if (!topic.link) continue
      const relative = topic.link.href.replace(/^\//, '')
      expect(existsSync(join(APP_DIR, relative, 'page.tsx')), topic.link.href).toBe(true)
    }
  })

  it('якоря карточек не повторяются и не совпадают со словарём', () => {
    const ids = HELP_TOPICS.map((topic) => topic.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain('terms')
  })

  it('представителю вуза не показываются разделы, которые ему закрыты', () => {
    const repTopics = topicsFor(true).map((topic) => topic.id)
    expect(repTopics).not.toContain('analytics')
    expect(repTopics).not.toContain('recommendations')
    expect(termsFor(true).every((term) => term.audience === 'all')).toBe(true)
  })

  it('сотрудник видит всё', () => {
    expect(topicsFor(false)).toHaveLength(HELP_TOPICS.length)
    expect(termsFor(false)).toHaveLength(HELP_TERMS.length)
  })
})
