import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import { RESPONSIBLE_ROLES, canBeResponsible, type UserRole } from '@/shared/contracts/enums'
import {
  PERMISSIONS,
  REVIEWER_FORBIDDEN_MESSAGE,
  type Permission,
  assertCan,
  assertReviewerAllowed,
  can,
  canSeeInternalNotes,
  isUniversityVisible,
  universityScope,
} from './permissions'
import type { CurrentUser } from './current-user'

const user = (role: UserRole, universityId: string | null = null, isReviewer = false): CurrentUser => ({
  id: 'user-1',
  email: 'demo@skilllink.demo',
  fullName: 'Демонстрационный Пользователь',
  role,
  universityId,
  isReviewer,
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

/** Права, оставленные эксперту (решение 147): весь список — в самом permissions.ts. */
const REVIEWER_ALLOWED_PERMISSIONS: readonly Permission[] = [
  'READ',
  'ANALYTICS',
  'UNIVERSITY_PORTAL',
  'CALENDAR',
  'CONTACT_DETAILS',
  'VENDORS',
  'INBOUND_READ',
]

function expectReviewerBlocked(reviewer: CurrentUser, permission: Permission): void {
  let threw = false
  try {
    assertCan(reviewer, permission)
  } catch (error) {
    threw = true
    expect((error as AppError).code).toBe('FORBIDDEN')
    expect((error as AppError).message).toBe(REVIEWER_FORBIDDEN_MESSAGE)
  }
  expect(threw).toBe(true)
}

describe('эксперт хакатона (решение 147): только чтение и выгрузки', () => {
  const blockedPermissions = (Object.keys(PERMISSIONS) as Permission[]).filter(
    (permission) => !REVIEWER_ALLOWED_PERMISSIONS.includes(permission),
  )

  it('список разрушающих прав не пуст (страховка от опечатки в списке выше)', () => {
    expect(blockedPermissions.length).toBeGreaterThan(0)
    expect(blockedPermissions).toEqual(
      expect.arrayContaining(['WRITE', 'ADMIN', 'ANALYTICS_WORK', 'DSAR_MANAGE', 'CONTACT_BASIS', 'SITE_ORDERS', 'UNIVERSITY_PORTAL_WRITE']),
    )
  })

  it('каждый разрушающий или изменяющий маршрут отдаёт 403 эксперту — перебором по списку прав', () => {
    for (const permission of blockedPermissions) {
      const roles = PERMISSIONS[permission] as readonly UserRole[]
      for (const role of roles) {
        const reviewer = user(role, role === 'UNIVERSITY_REP' ? 'uni-1' : null, true)
        // Право у роли есть — иначе assertCan бросил бы «Недостаточно прав», а не отказ эксперту.
        expect(can(reviewer, permission)).toBe(true)
        expectReviewerBlocked(reviewer, permission)
      }
    }
  })

  it('чтение и выгрузки остаются доступны эксперту', () => {
    for (const permission of REVIEWER_ALLOWED_PERMISSIONS) {
      const [role] = PERMISSIONS[permission] as readonly UserRole[]
      if (!role) throw new Error(`У права ${permission} нет ни одной роли`)
      const reviewer = user(role, role === 'UNIVERSITY_REP' ? 'uni-1' : null, true)
      expect(() => assertCan(reviewer, permission)).not.toThrow()
    }
  })

  it('кабинет вуза: право есть, но подтверждать за вуз эксперту-представителю нельзя', () => {
    // UNIVERSITY_PORTAL_WRITE проверяется через `can`, а не `assertCan` (portal.rules.ts),
    // поэтому это отдельная точка защиты, не покрытая перебором по PERMISSIONS выше.
    const reviewerRep = user('UNIVERSITY_REP', 'uni-1', true)
    expect(can(reviewerRep, 'UNIVERSITY_PORTAL_WRITE')).toBe(true)
    expect(() => assertReviewerAllowed(reviewerRep)).toThrowError(AppError)
  })

  it('обычные учётные записи (isReviewer не задан) не затронуты', () => {
    expect(() => assertCan(user('ADMIN'), 'WRITE')).not.toThrow()
    expect(() => assertCan(user('ADMIN'), 'ADMIN')).not.toThrow()
    expect(() => assertReviewerAllowed(user('UNIVERSITY_REP', 'uni-1'))).not.toThrow()
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

describe('роль «Руководитель» (ТЗ, решение 146)', () => {
  it('имеет права менеджера: чтение, запись, аналитику', () => {
    expect(can(user('HEAD'), 'READ')).toBe(true)
    expect(can(user('HEAD'), 'WRITE')).toBe(true)
    expect(can(user('HEAD'), 'ANALYTICS')).toBe(true)
    expect(can(user('HEAD'), 'ANALYTICS_WORK')).toBe(true)
  })

  it('может быть назначен ответственным за связку, как менеджер', () => {
    expect(canBeResponsible('HEAD')).toBe(true)
  })

  it('не получает права ADMIN и DSAR_MANAGE — только у ADMIN', () => {
    expect(can(user('HEAD'), 'ADMIN')).toBe(false)
    expect(can(user('HEAD'), 'DSAR_MANAGE')).toBe(false)
  })

  it('право переназначать ответственных (ASSIGN_RESPONSIBLE) — только ADMIN и HEAD', () => {
    expect(can(user('ADMIN'), 'ASSIGN_RESPONSIBLE')).toBe(true)
    expect(can(user('HEAD'), 'ASSIGN_RESPONSIBLE')).toBe(true)
    expect(can(user('MANAGER'), 'ASSIGN_RESPONSIBLE')).toBe(false)
    expect(can(user('ANALYST'), 'ASSIGN_RESPONSIBLE')).toBe(false)
    expect(can(user('VIEWER'), 'ASSIGN_RESPONSIBLE')).toBe(false)
    expect(can(user('UNIVERSITY_REP'), 'ASSIGN_RESPONSIBLE')).toBe(false)
  })
})
