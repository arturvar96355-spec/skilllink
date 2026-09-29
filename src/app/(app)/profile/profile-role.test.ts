import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CurrentUserDto, UserRole } from '@/shared/contracts'
import { allowedPaths, linkPath, mayLeadCooperations, roleGuide } from './profile-role'

/** Решение 236: блок роли в личном кабинете вместо нулей у тех, кто не ведёт связки. */

function user(role: UserRole, isReviewer = false): CurrentUserDto {
  return {
    id: 'u1',
    email: 'user@example.invalid',
    fullName: 'Тестовый Пользователь',
    position: null,
    role,
    universityId: role === 'UNIVERSITY_REP' ? 'uni-1' : null,
    universityName: role === 'UNIVERSITY_REP' ? 'Тестовый вуз' : null,
    isReviewer,
    permissions: {
      canWrite: !isReviewer && (role === 'ADMIN' || role === 'MANAGER'),
      canSeeAnalytics: role !== 'UNIVERSITY_REP',
      canWorkAnalytics: !isReviewer && (role === 'ADMIN' || role === 'MANAGER' || role === 'ANALYST'),
      canUsePortal: role === 'UNIVERSITY_REP' || role === 'ADMIN' || role === 'MANAGER' || role === 'HEAD',
      canWritePortal: role === 'UNIVERSITY_REP',
      canSeeContactDetails: role === 'ADMIN' || role === 'MANAGER',
      isAdmin: !isReviewer && role === 'ADMIN',
      canAssignResponsible: !isReviewer && (role === 'ADMIN' || role === 'HEAD'),
      canReviewLetters: !isReviewer && (role === 'ADMIN' || role === 'HEAD'),
      canSeeTeam: role === 'ADMIN' || role === 'HEAD' || (isReviewer && role !== 'UNIVERSITY_REP'),
      canAssignTasks: !isReviewer && (role === 'ADMIN' || role === 'HEAD'),
    },
    passwordTemporary: false,
  }
}

const STAFF: UserRole[] = ['ADMIN', 'HEAD', 'MANAGER', 'ANALYST', 'VIEWER']
const APP_DIR = join(process.cwd(), 'src', 'app', '(app)')

function pageExists(href: string): boolean {
  const path = linkPath(href)
  return existsSync(join(APP_DIR, path === '/' ? '' : path.slice(1), 'page.tsx'))
}

describe('блок роли в личном кабинете', () => {
  const cases: Array<[string, CurrentUserDto]> = [
    ...STAFF.map((role): [string, CurrentUserDto] => [role, user(role)]),
    ['эксперт-менеджер', user('MANAGER', true)],
    ['эксперт-администратор', user('ADMIN', true)],
    ['представитель вуза', user('UNIVERSITY_REP')],
    ['эксперт-представитель', user('UNIVERSITY_REP', true)],
  ]

  it.each(cases)('%s: есть фраза и не меньше трёх разделов', (_name, current) => {
    const guide = roleGuide(current)
    expect(guide.summary.length).toBeGreaterThan(20)
    expect(guide.links.length).toBeGreaterThanOrEqual(3)
  })

  it.each(cases)('%s: ссылки только в разделы из меню роли и на существующие страницы', (_name, current) => {
    const allowed = allowedPaths(current)
    for (const link of roleGuide(current).links) {
      expect(allowed.has(linkPath(link.href)), link.href).toBe(true)
      expect(pageExists(link.href), link.href).toBe(true)
    }
  })

  it('у эксперта — маршрут проверки по порядку, у сотрудника — просто разделы', () => {
    expect(roleGuide(user('ADMIN', true)).ordered).toBe(true)
    expect(roleGuide(user('ADMIN', true)).links.at(-1)?.label).toBe('Согласования')
    expect(roleGuide(user('MANAGER', true)).links.map((link) => link.label)).toContain('Команда')
    expect(roleGuide(user('ANALYST')).ordered).toBe(false)
  })

  it('разделы наблюдателя не ведут туда, где нужны права на изменение', () => {
    const labels = roleGuide(user('VIEWER')).links.map((link) => link.label)
    expect(labels).not.toContain('Пользователи')
    expect(labels).not.toContain('Команда')
  })

  it('«Ваша работа» с числами — только у тех, кто может вести связки', () => {
    expect(mayLeadCooperations(user('MANAGER'))).toBe(true)
    expect(mayLeadCooperations(user('HEAD'))).toBe(true)
    expect(mayLeadCooperations(user('ADMIN'))).toBe(true)
    expect(mayLeadCooperations(user('ANALYST'))).toBe(false)
    expect(mayLeadCooperations(user('VIEWER'))).toBe(false)
    expect(mayLeadCooperations(user('UNIVERSITY_REP'))).toBe(false)
    expect(mayLeadCooperations(user('MANAGER', true))).toBe(false)
  })
})
