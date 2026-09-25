import { describe, expect, it } from 'vitest'
import { isSharedDemoAccount } from '@/shared/config/auth.config'
import { PASSWORD_POLICY } from '@/shared/config/auth.config'
import type { UserRole } from '@/shared/contracts/enums'
import {
  TEMPORARY_PASSWORD_ALPHABET,
  assertUserChangeAllowed,
  describeOpenWork,
  generateTemporaryPassword,
  newPasswordProblem,
  resolveRoleAssignment,
  userChangeAuditActions,
  type UserChangeFacts,
} from './auth.rules'

/**
 * Правила управления пользователями: временный пароль, новый пароль, роль с вузом,
 * защиты от самоблокировки и потери последнего администратора.
 */

const ALLOWED = new Set(Object.values(TEMPORARY_PASSWORD_ALPHABET).join(''))

describe('временный пароль', () => {
  it('14 знаков из алфавита без похожих букв и цифр', () => {
    for (let run = 0; run < 200; run += 1) {
      const password = generateTemporaryPassword()
      expect(password).toHaveLength(PASSWORD_POLICY.temporaryLength)
      expect([...password].every((char) => ALLOWED.has(char))).toBe(true)
      expect(password).not.toMatch(/[0O1lIio]/)
    }
  })

  it('в алфавите нет похожих знаков, всего 54 знака', () => {
    const all = Object.values(TEMPORARY_PASSWORD_ALPHABET).join('')
    expect(all).toHaveLength(54)
    for (const lookalike of ['0', 'O', 'o', '1', 'l', 'I', 'i']) expect(all).not.toContain(lookalike)
  })

  it('в пароле есть заглавная, строчная и цифра', () => {
    for (let run = 0; run < 200; run += 1) {
      const password = generateTemporaryPassword()
      expect(password).toMatch(/[A-Z]/)
      expect(password).toMatch(/[a-z]/)
      expect(password).toMatch(/[2-9]/)
    }
  })

  it('пароли не повторяются', () => {
    const passwords = new Set(Array.from({ length: 500 }, () => generateTemporaryPassword()))
    expect(passwords.size).toBe(500)
  })

  it('набор без одной из групп перевыбирается, а не выдаётся', () => {
    // Сначала 14 раз подряд первый знак (одни заглавные «A»), потом по кругу.
    let call = 0
    const random = (max: number) => {
      call += 1
      return call <= 14 ? 0 : call % max
    }
    const password = generateTemporaryPassword(random)
    expect(password).not.toBe('A'.repeat(14))
    expect(password).toMatch(/[A-Z]/)
    expect(password).toMatch(/[a-z]/)
    expect(password).toMatch(/[2-9]/)
  })

  it('временный пароль сам проходит правила нового пароля', () => {
    const password = generateTemporaryPassword()
    expect(newPasswordProblem(password, { currentPassword: 'другой', email: 'a@b.ru' })).toBeNull()
  })
})

describe('новый пароль', () => {
  const context = { currentPassword: 'старый-пароль-1', email: 'Manager@SkillLink.demo' }

  it('подходящий пароль принимается', () => {
    expect(newPasswordProblem('новый-пароль-2026', context)).toBeNull()
  })

  it('не короче 10 символов — русские буквы считаются символами, а не байтами', () => {
    expect(newPasswordProblem('короткий9', context)).toContain('не короче 10')
    expect(newPasswordProblem('ровно10сим', context)).toBeNull()
  })

  it('не длиннее 72 байт: дальше bcrypt не читает', () => {
    expect(newPasswordProblem('a'.repeat(72), context)).toBeNull()
    expect(newPasswordProblem('a'.repeat(73), context)).toContain('72 байта')
    // 37 русских букв — 74 байта.
    expect(newPasswordProblem('я'.repeat(37), context)).toContain('72 байта')
  })

  it('не совпадает с текущим', () => {
    expect(newPasswordProblem('старый-пароль-1', context)).toBe('Новый пароль совпадает с текущим')
  })

  it('не совпадает с почтой — без учёта регистра', () => {
    expect(newPasswordProblem('manager@skilllink.demo', context)).toBe(
      'Пароль не должен совпадать с адресом почты',
    )
    expect(newPasswordProblem('MANAGER@SKILLLINK.DEMO', context)).not.toBeNull()
  })

  it('из одних пробелов — нельзя', () => {
    expect(newPasswordProblem(' '.repeat(12), context)).toContain('пробелов')
  })
})

describe('роль и вуз', () => {
  it('представителю вуза вуз обязателен', () => {
    expect(() => resolveRoleAssignment(null, { role: 'UNIVERSITY_REP' })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    )
    expect(resolveRoleAssignment(null, { role: 'UNIVERSITY_REP', universityId: 'uni-1' })).toEqual({
      role: 'UNIVERSITY_REP',
      universityId: 'uni-1',
    })
  })

  it('сотруднику ИТ-Школы вуз указать нельзя', () => {
    for (const role of ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'] as const) {
      expect(() => resolveRoleAssignment(null, { role, universityId: 'uni-1' })).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      )
      expect(resolveRoleAssignment(null, { role, universityId: null })).toEqual({ role, universityId: null })
    }
  })

  it('из представителя в сотрудника — вуз снимается сам', () => {
    const current = { role: 'UNIVERSITY_REP' as const, universityId: 'uni-1' }
    expect(resolveRoleAssignment(current, { role: 'VIEWER' })).toEqual({ role: 'VIEWER', universityId: null })
  })

  it('представитель остаётся при своём вузе, если вуз не передан', () => {
    const current = { role: 'UNIVERSITY_REP' as const, universityId: 'uni-1' }
    expect(resolveRoleAssignment(current, {})).toEqual(current)
    expect(resolveRoleAssignment(current, { universityId: 'uni-2' })).toEqual({
      role: 'UNIVERSITY_REP',
      universityId: 'uni-2',
    })
  })

  it('сотрудник становится представителем только с вузом', () => {
    const current = { role: 'VIEWER' as const, universityId: null }
    expect(() => resolveRoleAssignment(current, { role: 'UNIVERSITY_REP' })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    )
    expect(() => resolveRoleAssignment(current, { role: 'UNIVERSITY_REP', universityId: null })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    )
  })
})

function facts(overrides: {
  actorId?: string
  target?: Partial<UserChangeFacts['target']>
  next?: Partial<UserChangeFacts['next']>
  otherActiveAdmins?: number
  openWork?: UserChangeFacts['openWork']
}): UserChangeFacts {
  const target = { id: 'target', role: 'MANAGER' as UserRole, isActive: true, ...overrides.target }
  return {
    actorId: overrides.actorId ?? 'admin',
    target,
    next: { role: target.role, isActive: target.isActive, ...overrides.next },
    otherActiveAdmins: overrides.otherActiveAdmins ?? 1,
    openWork: overrides.openWork ?? { cooperations: 0, stages: 0 },
  }
}

const conflictError = expect.objectContaining({ code: 'CONFLICT' })

describe('защиты при изменении пользователя', () => {
  it('администратор не может заблокировать себя', () => {
    expect(() =>
      assertUserChangeAllowed(
        facts({ actorId: 'me', target: { id: 'me', role: 'ADMIN' }, next: { isActive: false }, otherActiveAdmins: 3 }),
      ),
    ).toThrowError(conflictError)
  })

  it('администратор не может снять с себя роль администратора', () => {
    expect(() =>
      assertUserChangeAllowed(
        facts({ actorId: 'me', target: { id: 'me', role: 'ADMIN' }, next: { role: 'MANAGER' }, otherActiveAdmins: 3 }),
      ),
    ).toThrowError(conflictError)
  })

  it('свои ФИО и должность администратор менять может', () => {
    expect(() =>
      assertUserChangeAllowed(facts({ actorId: 'me', target: { id: 'me', role: 'ADMIN' }, otherActiveAdmins: 0 })),
    ).not.toThrow()
  })

  it('последнего действующего администратора нельзя заблокировать', () => {
    expect(() =>
      assertUserChangeAllowed(facts({ target: { role: 'ADMIN' }, next: { isActive: false }, otherActiveAdmins: 0 })),
    ).toThrowError(conflictError)
  })

  it('последнего действующего администратора нельзя перевести в другую роль', () => {
    expect(() =>
      assertUserChangeAllowed(facts({ target: { role: 'ADMIN' }, next: { role: 'ANALYST' }, otherActiveAdmins: 0 })),
    ).toThrowError(conflictError)
  })

  it('если администратор не последний — можно', () => {
    expect(() =>
      assertUserChangeAllowed(facts({ target: { role: 'ADMIN' }, next: { isActive: false }, otherActiveAdmins: 1 })),
    ).not.toThrow()
  })

  it('заблокированного администратора можно менять и при единственном действующем', () => {
    expect(() =>
      assertUserChangeAllowed(
        facts({ target: { role: 'ADMIN', isActive: false }, next: { role: 'VIEWER' }, otherActiveAdmins: 0 }),
      ),
    ).not.toThrow()
  })

  it('менеджера с открытыми связками нельзя перевести в аналитика — «сначала передайте связки»', () => {
    const run = () =>
      assertUserChangeAllowed(
        facts({ target: { role: 'MANAGER' }, next: { role: 'ANALYST' }, openWork: { cooperations: 2, stages: 5 } }),
      )
    expect(run).toThrowError(conflictError)
    expect(run).toThrowError(/Сначала передайте связки/)
    expect(run).toThrowError(/2 открытые связки и 5 незакрытых этапов/)
  })

  it('с одними этапами — тоже нельзя', () => {
    expect(() =>
      assertUserChangeAllowed(
        facts({ target: { role: 'MANAGER' }, next: { role: 'VIEWER' }, openWork: { cooperations: 0, stages: 1 } }),
      ),
    ).toThrowError(conflictError)
  })

  it('менеджер в администраторы — можно: ответственным остаётся', () => {
    expect(() =>
      assertUserChangeAllowed(
        facts({ target: { role: 'MANAGER' }, next: { role: 'ADMIN' }, openWork: { cooperations: 2, stages: 5 } }),
      ),
    ).not.toThrow()
  })

  it('ответственного можно заблокировать — интерфейс лишь предупреждает', () => {
    expect(() =>
      assertUserChangeAllowed(
        facts({ target: { role: 'MANAGER' }, next: { isActive: false }, openWork: { cooperations: 3, stages: 12 } }),
      ),
    ).not.toThrow()
  })

  it('менеджера без открытой работы переводить можно', () => {
    expect(() => assertUserChangeAllowed(facts({ target: { role: 'MANAGER' }, next: { role: 'VIEWER' } }))).not.toThrow()
  })
})

describe('подписи и журнал', () => {
  it('открытая работа словами', () => {
    expect(describeOpenWork({ cooperations: 1, stages: 0 })).toBe('1 открытую связку')
    expect(describeOpenWork({ cooperations: 0, stages: 21 })).toBe('21 незакрытый этап')
    expect(describeOpenWork({ cooperations: 11, stages: 3 })).toBe('11 открытых связок и 3 незакрытых этапа')
  })

  const base = {
    role: 'MANAGER' as UserRole,
    isActive: true,
    universityId: null,
    fullName: 'Кириллов Пётр Андреевич',
    position: 'Менеджер',
  }

  it('роль — со старой и новой ролью', () => {
    expect(userChangeAuditActions(base, { ...base, role: 'ANALYST' })).toEqual([
      { action: 'user.role.change', payload: { from: 'MANAGER', to: 'ANALYST' } },
    ])
  })

  it('блокировка и разблокировка — отдельными действиями', () => {
    expect(userChangeAuditActions(base, { ...base, isActive: false })).toEqual([{ action: 'user.block' }])
    expect(userChangeAuditActions({ ...base, isActive: false }, base)).toEqual([{ action: 'user.unblock' }])
  })

  it('ФИО и должность — только именами полей, без значений', () => {
    const entries = userChangeAuditActions(base, { ...base, fullName: 'Другое Имя Отчество' })
    expect(entries).toEqual([{ action: 'user.update', payload: { fields: ['fullName'] } }])
    expect(JSON.stringify(entries)).not.toContain('Другое')
  })

  it('без изменений — без записей', () => {
    expect(userChangeAuditActions(base, { ...base })).toEqual([])
  })
})

describe('общие демо-учётные записи стенда (решение 99)', () => {
  it('засеянные демо-учётки — общие, проверка без учёта регистра и пробелов', () => {
    expect(isSharedDemoAccount('manager@skilllink.demo')).toBe(true)
    expect(isSharedDemoAccount(' Admin@SkillLink.demo ')).toBe(true)
    expect(isSharedDemoAccount('rep@spbgu.example.invalid')).toBe(true)
  })

  it('заведённые пользователи — не общие, даже на тех же доменах', () => {
    expect(isSharedDemoAccount('probe-user-1@example.invalid')).toBe(false)
    expect(isSharedDemoAccount('ivanova@skilllink.demo.ru')).toBe(false)
    expect(isSharedDemoAccount('new@skilllink.demo')).toBe(false)
  })
})
