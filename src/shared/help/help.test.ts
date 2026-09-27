import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PERMISSIONS, canSeeContactDetails, isReviewerAllowed } from '@/shared/auth/permissions'
import type { UserRole } from '@/shared/contracts/enums'
import { CATALOG_BODIES } from './content/catalog'
import { COOPERATION_BODIES } from './content/cooperations'
import { NOTIFY_TECH_BODIES } from './content/notify-tech'
import { REPORTS_ADMIN_BODIES } from './content/reports-admin'
import { START_BODIES } from './content/start'
import { TEAM_LETTERS_BODIES } from './content/team-letters'
import { TOOL_BODIES } from './content/tools'
import { HELP_TOOLS, helpEntry, type HelpRef } from './tools'
import {
  HELP_GROUPS,
  HELP_ROLE_COLUMNS,
  HELP_SECTIONS,
  HELP_SECTION_GROUPS,
  HELP_TERMS,
  HELP_TERMS_ANCHOR,
  HELP_TOPICS,
  HELP_TOPIC_IDS,
} from './index'

/**
 * Реестр документации (решение 214): один текст для «?», /docs, /help и
 * docs/USER_GUIDE.md. Проверки ловят то, что типы не ловят: пустой раздел,
 * ссылку «где найти» в никуда и таблицу прав, разошедшуюся с кодом.
 */

const APP = join(process.cwd(), 'src', 'app')

/** Страница по адресу: внутри каркаса `(app)`, на входе `(auth)` или открытая в `src/app`. */
function pageExists(href: string): boolean {
  const path = href.replace(/[?#].*$/, '')
  const relative = path === '/' ? '' : path.replace(/^\//, '')
  return [join(APP, '(app)', relative), join(APP, '(auth)', relative), ...(relative ? [join(APP, relative)] : [])].some(
    (dir) => existsSync(join(dir, 'page.tsx')),
  )
}

describe('реестр документации', () => {
  it('разделов — сколько задумано: от 35 до 60', () => {
    expect(HELP_SECTIONS.length).toBeGreaterThanOrEqual(35)
    expect(HELP_SECTIONS.length).toBeLessThanOrEqual(60)
  })

  it('ключи разделов уникальны, годятся для якоря и не совпадают со словарём', () => {
    const ids = HELP_SECTIONS.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
    // Двойной дефис занят под якорь подраздела (`<раздел>--<подраздел>`).
    for (const id of ids) expect(id, id).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
    expect(ids).not.toContain(HELP_TERMS_ANCHOR)
  })

  it('полный текст есть ровно у разделов реестра — без забытых и без лишних', () => {
    const bodyKeys = [
      ...Object.keys(START_BODIES),
      ...Object.keys(COOPERATION_BODIES),
      ...Object.keys(CATALOG_BODIES),
      ...Object.keys(TEAM_LETTERS_BODIES),
      ...Object.keys(REPORTS_ADMIN_BODIES),
      ...Object.keys(NOTIFY_TECH_BODIES),
    ]
    expect(new Set(bodyKeys).size).toBe(bodyKeys.length)
    expect([...bodyKeys].sort()).toEqual([...HELP_TOPIC_IDS].sort())
  })

  it.each(HELP_SECTIONS.map((section) => [section.id, section] as const))(
    '%s: есть «что это», «как», шаги, кто может и 3–5 частых вопросов',
    (_id, section) => {
      expect(section.title.trim()).not.toBe('')
      expect(section.short.trim().length).toBeGreaterThan(20)
      expect(section.short.length, 'short — одна фраза для подсказки').toBeLessThanOrEqual(170)
      expect(section.how.trim().length).toBeGreaterThan(20)
      expect(section.how.length, 'how — одна-две строки для подсказки').toBeLessThanOrEqual(200)
      expect(section.about.length).toBeGreaterThanOrEqual(1)
      expect(section.why.trim()).not.toBe('')
      expect(section.who.trim()).not.toBe('')
      expect(section.steps.length).toBeGreaterThanOrEqual(3)
      expect(section.faq.length).toBeGreaterThanOrEqual(3)
      expect(section.faq.length).toBeLessThanOrEqual(5)
      for (const item of section.faq) {
        expect(item.q.trim()).not.toBe('')
        expect(item.a.trim()).not.toBe('')
      }
    },
  )

  it.each(HELP_SECTIONS.map((section) => [section.id, section.where.href] as const))(
    '%s: «где найти» ведёт на существующую страницу (%s)',
    (_id, href) => {
      expect(href.startsWith('/'), 'адрес — внутри системы').toBe(true)
      expect(pageExists(href), href).toBe(true)
    },
  )

  it('в каждой группе есть разделы, у каждого раздела — известная группа', () => {
    const groupIds = new Set(HELP_GROUPS.map((group) => group.id))
    for (const section of HELP_SECTIONS) expect(groupIds.has(section.group), section.id).toBe(true)
    expect(HELP_SECTION_GROUPS.map((group) => group.id)).toEqual(HELP_GROUPS.map((group) => group.id))
  })

  it('старое название «Рекомендации» не выдаётся за текущее, кнопки «Пересобрать» нет', () => {
    for (const section of HELP_SECTIONS) {
      const text = [section.title, section.short, section.how, ...section.about, ...section.steps].join(' ')
      // Упоминание прежнего названия допустимо только как прежнего: «раньше назывался «Рекомендации»».
      expect(text, section.id).not.toMatch(/(?<!назывался )«Рекомендации»/)
      expect(text, section.id).not.toMatch(/нажмите «Пересобрать/)
    }
  })

  it('термины словаря не повторяются', () => {
    const terms = HELP_TERMS.map((item) => item.term)
    expect(new Set(terms).size).toBe(terms.length)
  })

  it('краткая часть подсказки и полный раздел — один и тот же текст', () => {
    for (const section of HELP_SECTIONS) {
      expect(section.title).toBe(HELP_TOPICS[section.id].title)
      expect(section.short).toBe(HELP_TOPICS[section.id].short)
      expect(section.how).toBe(HELP_TOPICS[section.id].how)
    }
  })
})

describe('подразделы «кнопки и блоки» (решение 217)', () => {
  const tools = HELP_SECTIONS.flatMap((section) => section.tools.map((tool) => [section.id, tool] as const))

  it('подразделов достаточно, чтобы «?» стоял у кнопок, а не только у экранов', () => {
    expect(tools.length).toBeGreaterThanOrEqual(60)
  })

  it('якоря подразделов уникальны, годятся для адреса и не совпадают с разделами', () => {
    const topicIds = new Set<string>(HELP_TOPIC_IDS)
    const anchors = tools.map(([, tool]) => tool.anchor)
    expect(new Set(anchors).size).toBe(anchors.length)
    for (const [id, tool] of tools) {
      expect(tool.key, tool.anchor).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
      expect(tool.anchor).toBe(`${id}--${tool.key}`)
      expect(topicIds.has(tool.anchor), tool.anchor).toBe(false)
    }
  })

  it('полный текст есть ровно у подразделов реестра', () => {
    expect(Object.keys(TOOL_BODIES).sort()).toEqual(Object.keys(HELP_TOOLS).sort())
    for (const [topic, summaries] of Object.entries(HELP_TOOLS)) {
      const bodies = TOOL_BODIES[topic as keyof typeof TOOL_BODIES]
      expect(Object.keys(bodies).sort(), topic).toEqual(Object.keys(summaries).sort())
    }
  })

  it.each(tools.map(([, tool]) => [tool.anchor, tool] as const))('%s: заголовок, «что это», «как» и «кто может»', (_anchor, tool) => {
    expect(tool.title.trim()).not.toBe('')
    expect(tool.short.trim().length).toBeGreaterThan(20)
    expect(tool.short.length, 'short — одна фраза для подсказки').toBeLessThanOrEqual(170)
    expect(tool.how.trim().length).toBeGreaterThan(20)
    expect(tool.how.length, 'how — одна-две строки для подсказки').toBeLessThanOrEqual(200)
    expect(tool.who.trim()).not.toBe('')
    for (const paragraph of tool.details) expect(paragraph.trim()).not.toBe('')
  })

  it('подсказка ведёт в справку на подраздел, а без подраздела — на раздел', () => {
    const withSection: HelpRef = { topic: 'cooperation-card', section: 'owner' }
    expect(helpEntry(withSection).href).toBe('/help#cooperation-card--owner')
    expect(helpEntry(withSection).title).toBe(HELP_TOOLS['cooperation-card'].owner.title)
    expect(helpEntry({ topic: 'dashboard' }).href).toBe('/help#dashboard')
    expect(helpEntry({ topic: 'dashboard' }).title).toBe(HELP_TOPICS.dashboard.title)
  })
})

describe('таблица «Роли и права» совпадает с permissions.ts', () => {
  const rows = HELP_SECTIONS.find((section) => section.id === 'roles')?.rights ?? []

  it('таблица есть и в ней все колонки', () => {
    expect(rows.length).toBeGreaterThan(8)
    for (const row of rows) {
      for (const column of HELP_ROLE_COLUMNS) expect(row.cells[column.key], `${row.label} / ${column.label}`).toBeTruthy()
    }
  })

  /**
   * Права, которые код даёт сверх списка роли, — с тем же ограничением, что в ячейке.
   * Представитель вуза видит контакты своего вуза: `canSeeContactDetails` пускает
   * его отдельно, хотя роли нет в `CONTACT_DETAILS`.
   */
  const SPECIAL: Partial<Record<string, Partial<Record<string, string>>>> = {
    CONTACT_DETAILS: { UNIVERSITY_REP: 'свой вуз' },
  }

  it('особый случай «свой вуз» у контактов действительно разрешён кодом', () => {
    const rep = { role: 'UNIVERSITY_REP', universityId: 'u1' } as Parameters<typeof canSeeContactDetails>[0]
    expect(canSeeContactDetails(rep, 'u1')).toBe(true)
    expect(canSeeContactDetails(rep, 'u2')).toBe(false)
  })

  it.each(rows.filter((row) => row.permission).map((row) => [row.label, row] as const))('%s', (_label, row) => {
    const permission = row.permission!
    const allowed = PERMISSIONS[permission] as readonly UserRole[]
    for (const column of HELP_ROLE_COLUMNS) {
      const special = SPECIAL[permission]?.[column.key]
      if (special) {
        expect(row.cells[column.key], `${row.label}: ${column.label}`).toBe(special)
        continue
      }
      const says = row.cells[column.key] !== '—'
      if (column.key === 'REVIEWER') {
        // Эксперт — учётная запись роли сотрудника: может ровно то, что открыто экспертам.
        expect(says, `${row.label}: эксперт`).toBe(isReviewerAllowed(permission))
      } else {
        expect(says, `${row.label}: ${column.label}`).toBe(allowed.includes(column.key))
      }
    }
  })
})
