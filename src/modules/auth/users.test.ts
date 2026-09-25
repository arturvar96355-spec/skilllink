import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compare, hash } from 'bcryptjs'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'
import { LOGIN_THROTTLE } from '@/shared/config/auth.config'
import { checkLogin, recordFailure, resetThrottle } from '@/shared/auth/throttle'

/**
 * Управление пользователями и смена своего пароля. База и журнал подменены:
 * проверяется, кому что разрешено, что уходит в базу и в журнал и что — в ответ.
 */
const mocks = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  university: { findUnique: vi.fn() },
  cooperation: { count: vi.fn() },
  workflowStage: { count: vi.fn() },
  auditLog: { findFirst: vi.fn() },
  calendarFeed: { deleteMany: vi.fn() },
  queryRaw: vi.fn(),
  writeAudit: vi.fn(),
}))

vi.mock('@/shared/db/prisma', () => {
  const client = {
    user: mocks.user,
    university: mocks.university,
    cooperation: mocks.cooperation,
    workflowStage: mocks.workflowStage,
    auditLog: mocks.auditLog,
    calendarFeed: mocks.calendarFeed,
    $queryRaw: mocks.queryRaw,
  }
  return { prisma: { ...client, $transaction: (fn: (tx: typeof client) => unknown) => fn(client) } }
})

vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))

const service = await import('./auth.service')

const as = (role: UserRole, id = 'me'): CurrentUser => ({
  id,
  email: `${id}@skilllink.demo`,
  fullName: 'Текущий Пользователь',
  role,
  universityId: role === 'UNIVERSITY_REP' ? 'uni-1' : null,
})

function row(overrides: Partial<{ id: string; role: UserRole; isActive: boolean; universityId: string | null }> = {}) {
  return {
    id: 'target',
    email: 'target@skilllink.demo',
    fullName: 'Целевой Пользователь Тестович',
    position: 'Менеджер',
    role: 'MANAGER' as UserRole,
    universityId: null,
    isActive: true,
    university: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  }
}

const NOT_ADMIN: UserRole[] = ['MANAGER', 'ANALYST', 'VIEWER', 'UNIVERSITY_REP']
const forbiddenError = expect.objectContaining({ code: 'FORBIDDEN' })

beforeEach(() => {
  vi.clearAllMocks()
  resetThrottle()
  mocks.cooperation.count.mockResolvedValue(0)
  mocks.workflowStage.count.mockResolvedValue(0)
  mocks.user.count.mockResolvedValue(1)
  mocks.queryRaw.mockResolvedValue([])
  mocks.calendarFeed.deleteMany.mockResolvedValue({ count: 0 })
})

describe('права: управление пользователями — только администратор', () => {
  it.each(NOT_ADMIN)('%s получает 403 на всех действиях администратора', async (role) => {
    const user = as(role)
    await expect(service.getManagedUser(user, 'target')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      service.createUser(user, { email: 'new@skilllink.demo', fullName: 'Новый Сотрудник', role: 'VIEWER' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(service.updateUser(user, 'target', { isActive: false })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(service.resetPassword(user, 'target')).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // До базы отказ не доходит: ни чтения, ни записи.
    expect(mocks.user.update).not.toHaveBeenCalled()
    expect(mocks.user.create).not.toHaveBeenCalled()
    expect(mocks.writeAudit).not.toHaveBeenCalled()
  })

  it('представитель вуза не может выдать пароль даже самому себе через сброс', async () => {
    await expect(service.resetPassword(as('UNIVERSITY_REP'), 'me')).rejects.toEqual(forbiddenError)
  })
})

describe('заведение пользователя', () => {
  beforeEach(() => {
    mocks.user.findUnique.mockResolvedValue(null)
    mocks.user.create.mockImplementation(async ({ data }) => ({ ...row(), id: 'new-id', ...data }))
  })

  it('пароль в ответе один раз, в базу — только хеш bcrypt', async () => {
    const result = await service.createUser(as('ADMIN'), {
      email: 'new@skilllink.demo',
      fullName: 'Новый Сотрудник Иванович',
      role: 'VIEWER',
    })

    expect(result.temporaryPassword).toHaveLength(14)
    const saved = mocks.user.create.mock.calls[0]![0].data
    expect(saved.passwordHash).not.toBe(result.temporaryPassword)
    expect(saved.passwordHash).toMatch(/^\$2[aby]\$10\$/)
    expect(await compare(result.temporaryPassword, saved.passwordHash)).toBe(true)
    expect(JSON.stringify(result.user)).not.toContain('passwordHash')
  })

  it('в журнале — роль, без пароля, хеша, почты и ФИО', async () => {
    mocks.university.findUnique.mockResolvedValue({ id: 'uni-1', archivedAt: null })
    const result = await service.createUser(as('ADMIN'), {
      email: 'new@skilllink.demo',
      fullName: 'Новый Сотрудник Иванович',
      role: 'UNIVERSITY_REP',
      universityId: 'uni-1',
    })

    const entry = mocks.writeAudit.mock.calls[0]![0]
    expect(entry).toMatchObject({ action: 'user.create', objectType: 'User', objectId: 'new-id', userId: 'me' })
    const logged = JSON.stringify(entry)
    expect(logged).not.toContain(result.temporaryPassword)
    expect(logged).not.toContain('$2')
    expect(logged).not.toContain('new@skilllink.demo')
    expect(logged).not.toContain('Новый')
  })

  it('занятая почта — 409', async () => {
    mocks.user.findUnique.mockResolvedValue({ id: 'someone' })
    await expect(
      service.createUser(as('ADMIN'), { email: 'taken@skilllink.demo', fullName: 'Кто-то Ещё', role: 'VIEWER' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(mocks.user.create).not.toHaveBeenCalled()
  })

  it('представитель без вуза — 422, сотрудник с вузом — 422', async () => {
    await expect(
      service.createUser(as('ADMIN'), { email: 'rep@x.ru', fullName: 'Представитель Вуза', role: 'UNIVERSITY_REP' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(
      service.createUser(as('ADMIN'), {
        email: 'm@x.ru',
        fullName: 'Менеджер Новый',
        role: 'MANAGER',
        universityId: 'uni-1',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('вуз в архиве или несуществующий — 422', async () => {
    mocks.university.findUnique.mockResolvedValueOnce({ id: 'uni-1', archivedAt: new Date() })
    await expect(
      service.createUser(as('ADMIN'), {
        email: 'rep@x.ru',
        fullName: 'Представитель Вуза',
        role: 'UNIVERSITY_REP',
        universityId: 'uni-1',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    mocks.university.findUnique.mockResolvedValueOnce(null)
    await expect(
      service.createUser(as('ADMIN'), {
        email: 'rep@x.ru',
        fullName: 'Представитель Вуза',
        role: 'UNIVERSITY_REP',
        universityId: 'nope',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})

describe('изменение пользователя', () => {
  it('администратор не может заблокировать себя — 409, в базу ничего', async () => {
    mocks.user.findUnique.mockResolvedValue(row({ id: 'me', role: 'ADMIN' }))
    await expect(service.updateUser(as('ADMIN'), 'me', { isActive: false })).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(mocks.user.update).not.toHaveBeenCalled()
  })

  it('последнего администратора не заблокировать — 409', async () => {
    mocks.user.findUnique.mockResolvedValue(row({ id: 'other-admin', role: 'ADMIN' }))
    mocks.user.count.mockResolvedValue(0)
    await expect(service.updateUser(as('ADMIN'), 'other-admin', { isActive: false })).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })

  it('смена роли менеджера с открытыми связками — 409 «сначала передайте связки»', async () => {
    mocks.user.findUnique.mockResolvedValue(row())
    mocks.cooperation.count.mockResolvedValue(3)
    await expect(service.updateUser(as('ADMIN'), 'target', { role: 'ANALYST' })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('Сначала передайте связки'),
    })
  })

  it('блокировка ответственного проходит и пишется в журнал без персональных данных', async () => {
    mocks.user.findUnique.mockResolvedValue(row())
    mocks.cooperation.count.mockResolvedValue(3)
    mocks.user.update.mockResolvedValue(row({ isActive: false }))

    const result = await service.updateUser(as('ADMIN'), 'target', { isActive: false })
    expect(result.isActive).toBe(false)
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.block', objectType: 'User', objectId: 'target' }),
    )
    // Строки администраторов и изменяемого заблокированы до конца транзакции.
    expect(mocks.queryRaw).toHaveBeenCalled()
  })

  it('смена роли пишется со старой и новой ролью', async () => {
    mocks.user.findUnique.mockResolvedValue(row({ role: 'VIEWER' }))
    mocks.user.update.mockResolvedValue(row({ role: 'ANALYST' }))
    await service.updateUser(as('ADMIN'), 'target', { role: 'ANALYST' })
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.role.change', payload: { from: 'VIEWER', to: 'ANALYST' } }),
    )
  })

  it('несуществующий пользователь — 404', async () => {
    mocks.user.findUnique.mockResolvedValue(null)
    await expect(service.updateUser(as('ADMIN'), 'nope', { fullName: 'Имя Фамилия' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('выдача временного пароля', () => {
  it('свой пароль сбросом не меняется — 409', async () => {
    await expect(service.resetPassword(as('ADMIN'), 'me')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(mocks.user.update).not.toHaveBeenCalled()
  })

  it('новый пароль в ответе, хеш в базе, журнал без пароля, блокировка входа снята', async () => {
    mocks.user.findUnique.mockResolvedValue({ id: 'target' })
    mocks.user.update.mockImplementation(async () => row())
    const source = { account: 'target@skilllink.demo', address: '203.0.113.5' }
    for (let index = 0; index < LOGIN_THROTTLE.maxFailures; index += 1) recordFailure(source)
    expect(checkLogin(source).blocked).toBe(true)

    const result = await service.resetPassword(as('ADMIN'), 'target')

    const saved = mocks.user.update.mock.calls[0]![0].data.passwordHash as string
    expect(await compare(result.temporaryPassword, saved)).toBe(true)
    expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain(result.temporaryPassword)
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.password.reset', objectId: 'target' }),
    )
    expect(checkLogin(source).blocked).toBe(false)
  })
})

describe('смена своего пароля', () => {
  const CURRENT = 'текущий-пароль-1'
  let currentHash = ''

  beforeEach(async () => {
    currentHash ||= await hash(CURRENT, 4)
    mocks.user.findUnique.mockImplementation(async ({ select }) =>
      select?.passwordHash ? { passwordHash: currentHash } : { id: 'me' },
    )
    mocks.user.update.mockResolvedValue(row({ id: 'me' }))
  })

  it.each<UserRole>(['UNIVERSITY_REP', 'VIEWER', 'MANAGER', 'ADMIN'])(
    '%s меняет свой пароль — и только свой',
    async (role) => {
      await service.changeOwnPassword(as(role), { currentPassword: CURRENT, newPassword: 'новый-пароль-2026' }, 'a1')
      const call = mocks.user.update.mock.calls[0]![0]
      expect(call.where).toEqual({ id: 'me' })
      expect(await compare('новый-пароль-2026', call.data.passwordHash)).toBe(true)
      expect(mocks.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.password.change', objectId: 'me', userId: 'me' }),
      )
      expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain('новый-пароль')
    },
  )

  it('неверный текущий пароль — 422 по полю currentPassword', async () => {
    await expect(
      service.changeOwnPassword(as('MANAGER'), { currentPassword: 'не-тот', newPassword: 'новый-пароль-2026' }, 'a2'),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [expect.objectContaining({ field: 'currentPassword' })],
    })
    expect(mocks.user.update).not.toHaveBeenCalled()
  })

  it('правила нового пароля — 422 по полю newPassword, до проверки текущего', async () => {
    for (const newPassword of ['короткий', CURRENT, 'me@skilllink.demo']) {
      await expect(
        service.changeOwnPassword(as('MANAGER'), { currentPassword: CURRENT, newPassword }, 'a3'),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [expect.objectContaining({ field: 'newPassword' })],
      })
    }
    expect(mocks.user.findUnique).not.toHaveBeenCalled()
  })

  it('перебор текущего пароля ограничен так же, как вход: шестая попытка — 403', async () => {
    const attempt = (currentPassword: string) =>
      service.changeOwnPassword(as('MANAGER'), { currentPassword, newPassword: 'новый-пароль-2026' }, 'a4')

    for (let index = 0; index < LOGIN_THROTTLE.maxFailures; index += 1) {
      await expect(attempt('не-тот')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    }
    // Теперь не проходит и верный: счётчик общий со входом.
    await expect(attempt(CURRENT)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('Слишком много неверных попыток'),
    })
    expect(checkLogin({ account: 'me@skilllink.demo', address: 'a4' }).blocked).toBe(true)
  })
})

describe('временный ли пароль', () => {
  it('по последнему событию пароля в журнале', () => {
    expect(service.isTemporaryPassword('user.create')).toBe(true)
    expect(service.isTemporaryPassword('user.password.reset')).toBe(true)
    expect(service.isTemporaryPassword('user.password.change')).toBe(false)
    expect(service.isTemporaryPassword(null)).toBe(false)
  })

  it('GET /api/me: временный пароль заметен, демо-пользователь без событий — нет', async () => {
    mocks.user.findUnique.mockResolvedValue({ position: null, university: null })
    mocks.auditLog.findFirst.mockResolvedValueOnce({ action: 'user.password.reset' })
    expect((await service.currentUserProfile(as('VIEWER'))).passwordTemporary).toBe(true)
    mocks.auditLog.findFirst.mockResolvedValueOnce(null)
    expect((await service.currentUserProfile(as('VIEWER'))).passwordTemporary).toBe(false)
  })
})

describe('карточка пользователя для администратора', () => {
  it('с открытой работой', async () => {
    mocks.user.findUnique.mockResolvedValue(row())
    mocks.cooperation.count.mockResolvedValue(2)
    mocks.workflowStage.count.mockResolvedValue(7)
    const result = await service.getManagedUser(as('ADMIN'), 'target')
    expect(result).toMatchObject({ id: 'target', email: 'target@skilllink.demo', openCooperations: 2, openStages: 7 })
    expect(JSON.stringify(result)).not.toContain('passwordHash')
  })

  it('нет такого — 404', async () => {
    mocks.user.findUnique.mockResolvedValue(null)
    await expect(service.getManagedUser(as('ADMIN'), 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('отзыв сессий (решение 109): версия растёт в четырёх случаях', () => {
  const INCREMENT = { increment: 1 }
  const lastUpdate = () => mocks.user.update.mock.calls.at(-1)![0]

  it('смена своего пароля: версия +1, текущая сессия переоформляется на записанную версию', async () => {
    const hashed = await hash('текущий-пароль-1', 4)
    mocks.user.findUnique.mockImplementation(async ({ select }) =>
      select?.passwordHash ? { passwordHash: hashed } : { id: 'me' },
    )
    mocks.user.update.mockResolvedValue({ ...row({ id: 'me' }), sessionVersion: 4 })
    const renew = vi.fn().mockResolvedValue(true)

    const result = await service.changeOwnPassword(
      as('VIEWER'),
      { currentPassword: 'текущий-пароль-1', newPassword: 'новый-пароль-2026' },
      's1',
      renew,
    )

    expect(lastUpdate().data.sessionVersion).toEqual(INCREMENT)
    expect(lastUpdate().select.sessionVersion).toBe(true)
    expect(renew).toHaveBeenCalledWith(4)
    expect(result.sessionRenewed).toBe(true)
  })

  it('смена своего пароля без продления (демо-cookie, сбой) — пароль сменён, sessionRenewed=false', async () => {
    const hashed = await hash('текущий-пароль-1', 4)
    mocks.user.findUnique.mockImplementation(async ({ select }) =>
      select?.passwordHash ? { passwordHash: hashed } : { id: 'me' },
    )
    mocks.user.update.mockResolvedValue({ ...row({ id: 'me' }), sessionVersion: 1 })
    const result = await service.changeOwnPassword(
      as('VIEWER'),
      { currentPassword: 'текущий-пароль-1', newPassword: 'новый-пароль-2026' },
      's2',
    )
    expect(lastUpdate().data.sessionVersion).toEqual(INCREMENT)
    expect(result.sessionRenewed).toBe(false)
  })

  it('сброс пароля администратором: версия +1', async () => {
    mocks.user.findUnique.mockResolvedValue({ id: 'target' })
    mocks.user.update.mockResolvedValue({ ...row(), sessionVersion: 1 })
    await service.resetPassword(as('ADMIN'), 'target')
    expect(lastUpdate().data.sessionVersion).toEqual(INCREMENT)
  })

  it('блокировка: версия +1, подписка на календарь удалена в той же транзакции, запись в журнале', async () => {
    mocks.user.findUnique.mockResolvedValue(row())
    mocks.user.update.mockResolvedValue(row({ isActive: false }))
    mocks.calendarFeed.deleteMany.mockResolvedValue({ count: 1 })

    await service.updateUser(as('ADMIN'), 'target', { isActive: false })

    expect(lastUpdate().data.sessionVersion).toEqual(INCREMENT)
    expect(mocks.calendarFeed.deleteMany).toHaveBeenCalledWith({ where: { userId: 'target' } })
    // Журнал отзыва пишется тем же клиентом транзакции (второй аргумент).
    const revokeCall = mocks.writeAudit.mock.calls.find(([entry]) => entry.action === 'calendar.revoke')
    expect(revokeCall?.[0]).toMatchObject({
      userId: 'me',
      objectType: 'User',
      objectId: 'target',
      payload: { reason: 'user.block' },
    })
    expect(revokeCall?.[1]).toBeDefined()
  })

  it('блокировка без подписки — удалять нечего, записи об отзыве нет', async () => {
    mocks.user.findUnique.mockResolvedValue(row())
    mocks.user.update.mockResolvedValue(row({ isActive: false }))
    await service.updateUser(as('ADMIN'), 'target', { isActive: false })
    expect(mocks.calendarFeed.deleteMany).toHaveBeenCalled()
    expect(mocks.writeAudit.mock.calls.some(([entry]) => entry.action === 'calendar.revoke')).toBe(false)
  })

  it('смена роли: версия +1, подписку не трогает', async () => {
    mocks.user.findUnique.mockResolvedValue(row({ role: 'VIEWER' }))
    mocks.user.update.mockResolvedValue(row({ role: 'ANALYST' }))
    await service.updateUser(as('ADMIN'), 'target', { role: 'ANALYST' })
    expect(lastUpdate().data.sessionVersion).toEqual(INCREMENT)
    expect(mocks.calendarFeed.deleteMany).not.toHaveBeenCalled()
  })

  it('ФИО, должность и разблокировка сессии не отзывают', async () => {
    mocks.user.findUnique.mockResolvedValue(row())
    mocks.user.update.mockResolvedValue({ ...row(), position: 'Руководитель' })
    await service.updateUser(as('ADMIN'), 'target', { fullName: 'Другое Имя', position: 'Руководитель' })
    expect(lastUpdate().data).not.toHaveProperty('sessionVersion')

    mocks.user.findUnique.mockResolvedValue(row({ isActive: false }))
    mocks.user.update.mockResolvedValue(row({ isActive: true }))
    await service.updateUser(as('ADMIN'), 'target', { isActive: true })
    expect(lastUpdate().data).not.toHaveProperty('sessionVersion')
    expect(mocks.calendarFeed.deleteMany).not.toHaveBeenCalled()
  })
})
