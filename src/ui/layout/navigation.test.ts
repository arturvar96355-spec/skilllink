import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CurrentUserDto, UserRole } from '@/shared/contracts'
import { ROUTES } from '../lib/links'
import { navigationFor, serviceLinksFor } from './navigation'

/**
 * Пункт меню обязан вести на существующую страницу.
 *
 * Проверка глупая на вид, но именно она ловит самую обидную ошибку показа:
 * раздел переименовали или не создали, ссылка осталась, и на защите щелчок
 * по меню открывает 404. Типы тут не помогают — адрес это просто строка.
 */
const ROOT = process.cwd()
const APP_DIR = join(ROOT, 'src', 'app', '(app)')
/** Страницы вне каркаса — открытые без входа, как политика обработки ПД. */
const PUBLIC_DIR = join(ROOT, 'src', 'app')

function pageExists(href: string): boolean {
  // Путь вида `/universities` лежит в `src/app/(app)/universities/page.tsx`,
  // а главная — прямо в корне группы маршрутов. Открытые страницы — в `src/app/<путь>`.
  const relative = href === '/' ? '' : href.replace(/^\//, '')
  return (
    existsSync(join(APP_DIR, relative, 'page.tsx')) ||
    (relative !== '' && existsSync(join(PUBLIC_DIR, relative, 'page.tsx')))
  )
}

function user(role: UserRole): CurrentUserDto {
  return {
    id: 'u1',
    email: 'user@example.invalid',
    fullName: 'Тестовый Пользователь',
    position: null,
    role,
    universityId: role === 'UNIVERSITY_REP' ? 'uni-1' : null,
    universityName: role === 'UNIVERSITY_REP' ? 'Тестовый вуз' : null,
    permissions: {
      canWrite: role === 'ADMIN' || role === 'MANAGER',
      canSeeAnalytics: role !== 'UNIVERSITY_REP',
      canWorkAnalytics: role === 'ADMIN' || role === 'MANAGER' || role === 'ANALYST',
      canUsePortal: role === 'UNIVERSITY_REP',
      canWritePortal: role === 'UNIVERSITY_REP',
      isAdmin: role === 'ADMIN',
    },
  }
}

const ROLES: UserRole[] = ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER', 'UNIVERSITY_REP']

describe('боковое меню', () => {
  it.each(ROLES)('у роли %s все пункты ведут на существующие страницы', (role) => {
    const groups = navigationFor(user(role))
    expect(groups.length).toBeGreaterThan(0)

    for (const group of groups) {
      expect(group.items.length).toBeGreaterThan(0)
      for (const item of group.items) {
        expect(pageExists(item.href), `${item.label} → ${item.href}`).toBe(true)
      }
    }
  })

  it('представитель вуза не видит внутренних разделов', () => {
    const hrefs = navigationFor(user('UNIVERSITY_REP')).flatMap((group) =>
      group.items.map((item) => item.href),
    )

    // Аналитика, рекомендации и чужие реестры ему закрыты на сервере —
    // в меню их быть не должно, иначе ссылка ведёт к отказу доступа.
    expect(hrefs).not.toContain(ROUTES.analytics)
    expect(hrefs).not.toContain(ROUTES.recommendations)
    expect(hrefs).not.toContain(ROUTES.universities)
    expect(hrefs).toContain(ROUTES.portal)
  })

  it('роль без аналитики не получает пункт «Аналитика»', () => {
    const analyst = navigationFor(user('ANALYST')).flatMap((group) => group.items.map((i) => i.href))
    expect(analyst).toContain(ROUTES.analytics)
  })
})

describe('адреса страниц', () => {
  it('каждый известный маршрут существует', () => {
    for (const [name, href] of Object.entries(ROUTES)) {
      // Вход лежит вне группы внутренних страниц — у него свой каркас.
      if (href === ROUTES.login) {
        expect(existsSync(join(ROOT, 'src', 'app', '(auth)', 'login', 'page.tsx')), name).toBe(true)
        continue
      }
      expect(pageExists(href), `${name} → ${href}`).toBe(true)
    }
  })
})

describe('подвал', () => {
  it('представителю вуза не ведёт в настройки', () => {
    const hrefs = serviceLinksFor(user('UNIVERSITY_REP')).map((link) => link.href)
    expect(hrefs.some((href) => href.startsWith(ROUTES.settings))).toBe(false)
  })

  it.each(ROLES)('у роли %s в подвале есть политика обработки персональных данных', (role) => {
    expect(serviceLinksFor(user(role)).map((link) => link.href)).toContain(ROUTES.privacy)
  })

  it.each(ROLES)('у роли %s внутренние ссылки ведут на существующие страницы', (role) => {
    for (const link of serviceLinksFor(user(role)).filter((item) => !item.external)) {
      expect(pageExists(link.href.replace(/#.*$/, '')), `${link.label} → ${link.href}`).toBe(true)
    }
  })
})
