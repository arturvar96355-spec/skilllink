import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CurrentUserDto, UserRole } from '@/shared/contracts'
import { ROUTES } from '../lib/links'
import { navigationFor } from './navigation'

/**
 * Пункт меню обязан вести на существующую страницу.
 *
 * Проверка глупая на вид, но именно она ловит самую обидную ошибку показа:
 * раздел переименовали или не создали, ссылка осталась, и на защите щелчок
 * по меню открывает 404. Типы тут не помогают — адрес это просто строка.
 */
const ROOT = process.cwd()
const APP_DIR = join(ROOT, 'src', 'app', '(app)')

function pageExists(href: string): boolean {
  // Путь вида `/universities` лежит в `src/app/(app)/universities/page.tsx`,
  // а главная — прямо в корне группы маршрутов.
  const relative = href === '/' ? '' : href.replace(/^\//, '')
  return existsSync(join(APP_DIR, relative, 'page.tsx'))
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
      canUsePortal: role === 'UNIVERSITY_REP',
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
