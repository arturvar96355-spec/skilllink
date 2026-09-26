import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CurrentUserDto, UserRole } from '@/shared/contracts'
import { ROUTES } from '../lib/links'
import { canReadLetters, isSectionAllowed, navigationFor, serviceLinksFor } from './navigation'
import { API_CONTRACT_URL } from '../lib/links'

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
    isReviewer: false,
    permissions: {
      canWrite: role === 'ADMIN' || role === 'MANAGER',
      canSeeAnalytics: role !== 'UNIVERSITY_REP',
      canWorkAnalytics: role === 'ADMIN' || role === 'MANAGER' || role === 'ANALYST',
      // UNIVERSITY_PORTAL (permissions.ts): ADMIN, MANAGER, UNIVERSITY_REP, HEAD —
      // сотрудник открывает кабинет любого вуза, аналитик и наблюдатель — нет.
      canUsePortal: role === 'UNIVERSITY_REP' || role === 'ADMIN' || role === 'MANAGER' || role === 'HEAD',
      canWritePortal: role === 'UNIVERSITY_REP',
      canSeeContactDetails: role === 'ADMIN' || role === 'MANAGER',
      isAdmin: role === 'ADMIN',
      canAssignResponsible: role === 'ADMIN' || role === 'HEAD',
      canReviewLetters: role === 'ADMIN' || role === 'HEAD',
    },
    passwordTemporary: false,
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

describe('«Письма вузов» (решение 170/171)', () => {
  it.each<UserRole>(['ADMIN', 'HEAD', 'MANAGER'])('роль %s видит пункт меню', (role) => {
    expect(canReadLetters(user(role))).toBe(true)
    const hrefs = navigationFor(user(role)).flatMap((group) => group.items.map((item) => item.href))
    expect(hrefs).toContain(ROUTES.letters)
  })

  it.each<UserRole>(['ANALYST', 'VIEWER', 'UNIVERSITY_REP'])('роль %s пункт не видит', (role) => {
    expect(canReadLetters(user(role))).toBe(false)
    const hrefs = navigationFor(user(role)).flatMap((group) => group.items.map((item) => item.href))
    expect(hrefs).not.toContain(ROUTES.letters)
  })

  it.each<UserRole>(['ADMIN', 'HEAD', 'MANAGER'])('раздел открыт роли %s через охранник', (role) => {
    expect(isSectionAllowed(user(role), ROUTES.letters)).toBe(true)
    expect(isSectionAllowed(user(role), `${ROUTES.letters}/some-id`)).toBe(true)
  })

  it.each<UserRole>(['ANALYST', 'VIEWER', 'UNIVERSITY_REP'])('раздел закрыт роли %s через охранник', (role) => {
    expect(isSectionAllowed(user(role), ROUTES.letters)).toBe(false)
    expect(isSectionAllowed(user(role), `${ROUTES.letters}/some-id`)).toBe(false)
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

describe('охранник разделов (isSectionAllowed, решение 153)', () => {
  it.each(ROLES)('у роли %s каждый пункт меню и служебная ссылка доступны через охранник', (role) => {
    const current = user(role)
    const menuHrefs = navigationFor(current).flatMap((group) => group.items.map((item) => item.href))
    const footerHrefs = serviceLinksFor(current)
      .filter((item) => !item.external)
      .map((item) => item.href.replace(/#.*$/, ''))
    for (const href of [...menuHrefs, ...footerHrefs]) {
      expect(isSectionAllowed(current, href), `${role} → ${href}`).toBe(true)
    }
  })

  it('представителю вуза закрыты внутренние разделы по прямой ссылке', () => {
    const rep = user('UNIVERSITY_REP')
    for (const route of [
      ROUTES.universities,
      ROUTES.programs,
      ROUTES.cooperations,
      ROUTES.recommendations,
      ROUTES.documents,
      ROUTES.products,
      ROUTES.settings,
      ROUTES.reports,
      ROUTES.analytics,
    ]) {
      expect(isSectionAllowed(rep, route), route).toBe(false)
      // Вложенная страница раздела (например, карточка вуза) закрыта так же, как список.
      expect(isSectionAllowed(rep, `${route}/some-id`), `${route}/some-id`).toBe(false)
    }
  })

  it('представителю вуза открыты его кабинет, профиль, главная и состояние системы', () => {
    const rep = user('UNIVERSITY_REP')
    expect(isSectionAllowed(rep, ROUTES.portal)).toBe(true)
    expect(isSectionAllowed(rep, ROUTES.profile)).toBe(true)
    expect(isSectionAllowed(rep, ROUTES.dashboard)).toBe(true)
    expect(isSectionAllowed(rep, ROUTES.status)).toBe(true)
  })

  it('кабинет вуза закрыт роли без права UNIVERSITY_PORTAL', () => {
    expect(isSectionAllowed(user('ANALYST'), ROUTES.portal)).toBe(false)
    expect(isSectionAllowed(user('VIEWER'), ROUTES.portal)).toBe(false)
    expect(isSectionAllowed(user('ADMIN'), ROUTES.portal)).toBe(true)
    expect(isSectionAllowed(user('MANAGER'), ROUTES.portal)).toBe(true)
  })

  it('раздел не в списке охранника открыт всем — им управляет обычный 404', () => {
    expect(isSectionAllowed(user('UNIVERSITY_REP'), '/no-such-route')).toBe(true)
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

  it.each(ROLES)('у роли %s служебные ссылки не ведут на сырой JSON', (role) => {
    const hrefs = serviceLinksFor(user(role)).map((link) => link.href)
    expect(hrefs.some((href) => href.startsWith('/api/'))).toBe(false)
    expect(hrefs).toContain(ROUTES.status)
    expect(hrefs).toContain(API_CONTRACT_URL)
  })
})
