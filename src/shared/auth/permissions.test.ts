import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import { RESPONSIBLE_ROLES, canBeResponsible, type UserRole } from '@/shared/contracts/enums'
import {
  PERMISSIONS,
  assertCan,
  can,
  canSeeInternalNotes,
  isUniversityVisible,
  universityScope,
} from './permissions'
import type { CurrentUser } from './current-user'

const user = (role: UserRole, universityId: string | null = null): CurrentUser => ({
  id: 'user-1',
  email: 'demo@skilllink.demo',
  fullName: 'Демонстрационный Пользователь',
  role,
  universityId,
})

describe('права ролей', () => {
  it('читать могут все роли', () => {
    const roles: UserRole[] = ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER', 'UNIVERSITY_REP']
    expect(roles.every((role) => can(user(role), 'READ'))).toBe(true)
  })

  it('писать могут только администратор и менеджер', () => {
    expect(can(user('ADMIN'), 'WRITE')).toBe(true)
    expect(can(user('MANAGER'), 'WRITE')).toBe(true)
    expect(can(user('ANALYST'), 'WRITE')).toBe(false)
    expect(can(user('VIEWER'), 'WRITE')).toBe(false)
    expect(can(user('UNIVERSITY_REP'), 'WRITE')).toBe(false)
  })

  it('представитель вуза не видит аналитику', () => {
    expect(can(user('UNIVERSITY_REP'), 'ANALYTICS')).toBe(false)
    expect(can(user('ANALYST'), 'ANALYTICS')).toBe(true)
    expect(can(user('VIEWER'), 'ANALYTICS')).toBe(true)
  })

  it('assertCan бросает FORBIDDEN при нехватке прав', () => {
    expect(() => assertCan(user('VIEWER'), 'WRITE')).toThrowError(AppError)
    try {
      assertCan(user('VIEWER'), 'WRITE')
    } catch (error) {
      expect((error as AppError).code).toBe('FORBIDDEN')
    }
  })
})

describe('внутренние заметки сотрудников', () => {
  it('сотрудники ИТ-Школы видят комментарии к этапам', () => {
    const roles: UserRole[] = ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER']
    expect(roles.every((role) => canSeeInternalNotes(user(role)))).toBe(true)
  })

  it('представитель вуза внутренние комментарии не видит', () => {
    expect(canSeeInternalNotes(user('UNIVERSITY_REP', 'uni-1'))).toBe(false)
  })
})

describe('кабинет вуза', () => {
  it('доступен администратору, менеджеру и представителю вуза', () => {
    expect(can(user('ADMIN'), 'UNIVERSITY_PORTAL')).toBe(true)
    expect(can(user('MANAGER'), 'UNIVERSITY_PORTAL')).toBe(true)
    expect(can(user('UNIVERSITY_REP', 'uni-1'), 'UNIVERSITY_PORTAL')).toBe(true)
  })

  it('записывает в кабинете только представитель вуза', () => {
    expect(can(user('UNIVERSITY_REP', 'uni-1'), 'UNIVERSITY_PORTAL_WRITE')).toBe(true)
    expect(can(user('ADMIN'), 'UNIVERSITY_PORTAL_WRITE')).toBe(false)
    expect(can(user('MANAGER'), 'UNIVERSITY_PORTAL_WRITE')).toBe(false)
  })

  it('аналитику и наблюдателю кабинет не нужен', () => {
    expect(can(user('ANALYST'), 'UNIVERSITY_PORTAL')).toBe(false)
    expect(can(user('VIEWER'), 'UNIVERSITY_PORTAL')).toBe(false)
  })
})

describe('ограничение по вузу', () => {
  it('сотруднику ИТ-Школы выборка не сужается', () => {
    expect(universityScope(user('MANAGER'))).toEqual({})
    expect(universityScope(user('ANALYST'))).toEqual({})
  })

  it('представителю вуза выборка сужается до своего вуза', () => {
    expect(universityScope(user('UNIVERSITY_REP', 'uni-1'))).toEqual({ universityId: 'uni-1' })
  })

  it('представитель без назначенного вуза не получает доступ ко всем вузам', () => {
    // Ошибка настройки учётной записи не должна превращаться в расширение прав.
    expect(() => universityScope(user('UNIVERSITY_REP', null))).toThrowError(AppError)
    try {
      universityScope(user('UNIVERSITY_REP', null))
    } catch (error) {
      expect((error as AppError).code).toBe('FORBIDDEN')
    }
  })

  it('представитель видит только свой вуз', () => {
    const rep = user('UNIVERSITY_REP', 'uni-1')
    expect(isUniversityVisible(rep, 'uni-1')).toBe(true)
    expect(isUniversityVisible(rep, 'uni-2')).toBe(false)
  })

  it('остальным ролям видны все вузы', () => {
    expect(isUniversityVisible(user('MANAGER'), 'uni-2')).toBe(true)
  })
})

describe('ответственный за запись', () => {
  it('назначается только администратор или менеджер', () => {
    expect(canBeResponsible('ADMIN')).toBe(true)
    expect(canBeResponsible('MANAGER')).toBe(true)
  })

  it('аналитик, наблюдатель и представитель вуза ответственными не бывают', () => {
    // Иначе аналитик числился бы ответственным за связку, в которой не может
    // изменить ни этапа.
    expect(canBeResponsible('ANALYST')).toBe(false)
    expect(canBeResponsible('VIEWER')).toBe(false)
    expect(canBeResponsible('UNIVERSITY_REP')).toBe(false)
  })

  it('ответственный всегда может изменять данные', () => {
    for (const role of RESPONSIBLE_ROLES) {
      expect((PERMISSIONS.WRITE as readonly UserRole[]).includes(role)).toBe(true)
    }
  })
})
