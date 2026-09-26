import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'
import { ANONYMIZED_CONTACT_NAME } from '@/modules/universities/universities.rules'
import { DSAR_REGISTRY } from './dsar.registry'
import { ERASED_USER_NAME, dueDate, erasedUserEmail, findSecretKeys } from './dsar.rules'

/**
 * «Всё о субъекте» (решение 116). База подменена: проверяется, кому что разрешено,
 * что собирается в выгрузку, что уходит в реестр запросов и в журнал.
 */
const tx = { marker: 'tx' }
const repo = vi.hoisted(() => ({
  loadSection: vi.fn(),
  applyErase: vi.fn(),
  inTransaction: vi.fn(),
  findUserSubject: vi.fn(),
  findContactSubject: vi.fn(),
  findUserChannels: vi.fn(),
  withUserLock: vi.fn(),
  withContactLock: vi.fn(),
  listRequests: vi.fn(),
  findOpenRequest: vi.fn(),
  createRequest: vi.fn(),
  completeOpenRequests: vi.fn(),
  createCompletedRequest: vi.fn(),
  withSelfExportLock: vi.fn(),
  findLastSelfExport: vi.fn(),
}))
const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }))

vi.mock('./dsar.repo', () => repo)
vi.mock('@/shared/audit/audit', () => audit)

const service = await import('./dsar.service')

const NOW = new Date('2026-09-25T09:00:00Z')

const as = (role: UserRole, id = 'admin-1'): CurrentUser => ({
  id,
  email: `${id}@example.invalid`,
  fullName: 'Текущий Администратор',
  role,
  universityId: role === 'UNIVERSITY_REP' ? 'uni-1' : null,
})

const TARGET = {
  id: 'user-7',
  email: 'ivanova@example.invalid',
  fullName: 'Иванова Мария Сергеевна',
  role: 'MANAGER',
  isActive: true,
}

const CONTACT = {
  id: 'contact-3',
  universityId: 'uni-1',
  fullName: 'Ветрова Ирина Павловна',
  position: 'Заместитель декана',
  email: 'vetrova@example.invalid',
  phone: '+7 900 000-00-00',
  isPrimary: true,
  legalBasis: 'LEGITIMATE_INTEREST',
}

const NOT_ADMIN: UserRole[] = ['MANAGER', 'ANALYST', 'VIEWER', 'UNIVERSITY_REP']

/** Всё, что ушло в журнал, одной строкой — для проверки «без ПД». */
const auditText = () => JSON.stringify(audit.writeAudit.mock.calls.map((call) => call[0]))

beforeEach(() => {
  vi.clearAllMocks()
  repo.inTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => fn(tx))
  repo.withSelfExportLock.mockImplementation(async (_id: string, fn: (client: unknown, last: Date | null) => unknown) =>
    fn(tx, null),
  )
  repo.findUserSubject.mockResolvedValue(TARGET)
  repo.findContactSubject.mockResolvedValue(CONTACT)
  repo.findUserChannels.mockResolvedValue({ telegram: false, calendar: false })
  repo.completeOpenRequests.mockResolvedValue([])
  repo.createCompletedRequest.mockResolvedValue('req-new')
  repo.findLastSelfExport.mockResolvedValue(null)
  repo.loadSection.mockImplementation(async (entry: { section: string; model: string }) => {
    if (entry.section === 'profile') {
      return { total: 1, items: [{ id: TARGET.id, email: TARGET.email, fullName: TARGET.fullName, createdAt: NOW }] }
    }
    if (entry.section === 'auditAboutSubject') {
      return {
        total: 3,
        items: [{ id: 'a1', action: 'export.download', payload: { address: '10.1.2.3', dataset: 'users' }, user: { id: 'x', role: 'ADMIN' } }],
      }
    }
    return { total: 0, items: [] }
  })
})

describe('права', () => {
  it.each(NOT_ADMIN)('%s получает 403 на всех действиях администратора и не трогает базу', async (role) => {
    const user = as(role, 'someone')
    const calls = [
      service.exportSubject(user, 'USER', 'user-7', NOW),
      service.exportSubject(user, 'CONTACT', 'contact-3', NOW),
      service.eraseUser(user, 'user-7', { confirm: TARGET.email }, NOW),
      service.eraseContact(user, 'contact-3', { confirm: CONTACT.fullName }, NOW),
      service.listRequests(user, { page: 1, pageSize: 20 }, NOW),
      service.registerRequest(user, { subjectType: 'USER', subjectId: 'user-7', kind: 'EXPORT' }, NOW),
    ]
    for (const call of calls) await expect(call).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(repo.findUserSubject).not.toHaveBeenCalled()
    expect(repo.loadSection).not.toHaveBeenCalled()
    expect(repo.withUserLock).not.toHaveBeenCalled()
    expect(audit.writeAudit).not.toHaveBeenCalled()
  })

  it.each([...NOT_ADMIN, 'ADMIN'] as UserRole[])('%s выгружает свои данные сам', async (role) => {
    const result = await service.exportOwnData(as(role, 'user-7'), { address: '10.0.0.5' }, NOW)
    expect(result.subject).toMatchObject({ type: 'USER', id: 'user-7' })
    expect(result.generatedBy).toEqual({ id: 'user-7', role, self: true })
  })
})

describe('выгрузка «всё о субъекте»', () => {
  it('разделы — ровно по реестру, журнал — отдельно, числа настоящие', async () => {
    const result = await service.exportSubject(as('ADMIN'), 'USER', 'user-7', NOW)

    const expectedSections = DSAR_REGISTRY.USER.filter((entry) => !entry.trail).map((entry) => entry.section)
    expect(Object.keys(result.data).sort()).toEqual([...expectedSections].sort())
    expect(result.auditTrail.byActor).not.toBeNull()
    expect(result.auditTrail.aboutSubject.total).toBe(3)
    expect(result.counts.auditAboutSubject).toBe(3)
    expect(result.data.profile!.items[0]).toMatchObject({ email: TARGET.email, createdAt: NOW.toISOString() })
  })

  it('сведения ч. 7 ст. 14 на месте', async () => {
    const result = await service.exportSubject(as('ADMIN'), 'USER', 'user-7', NOW)
    for (const key of ['operator', 'purposes', 'legalBasis', 'categories', 'sources', 'recipients', 'retention', 'rights']) {
      expect(result, key).toHaveProperty(key)
    }
    expect(result.legalBasis.join(' ')).toContain('трудовой договор')
    // Telegram не подключён — среди получателей его нет.
    expect(result.recipients.some((item) => item.recipient.includes('Telegram'))).toBe(false)
  })

  it('подключённый Telegram попадает в получатели как передача за рубеж', async () => {
    repo.findUserChannels.mockResolvedValue({ telegram: true, calendar: true })
    const result = await service.exportSubject(as('ADMIN'), 'USER', 'user-7', NOW)
    expect(result.recipients.find((item) => item.recipient.includes('Telegram'))?.crossBorder).toBe(true)
    expect(result.recipients.some((item) => item.recipient.includes('календар'))).toBe(true)
  })

  it('в выгрузке нет ключей-секретов, адрес действовавшего вырезан', async () => {
    const result = await service.exportSubject(as('ADMIN'), 'USER', 'user-7', NOW)
    expect(findSecretKeys(result)).toEqual([])
    expect(result.auditTrail.aboutSubject.items[0]!.payload).toEqual({ dataset: 'users' })
  })

  it('длинный раздел: total настоящий, отмечено «обрезано»', async () => {
    repo.loadSection.mockImplementation(async (entry: { section: string }) =>
      entry.section === 'stages' ? { total: 1200, items: [{ id: 's1' }] } : { total: 0, items: [] },
    )
    const result = await service.exportSubject(as('ADMIN'), 'USER', 'user-7', NOW)
    expect(result.data.stages).toMatchObject({ total: 1200, returned: 1, truncated: true })
  })

  it('закрывает открытый запрос по письму', async () => {
    repo.completeOpenRequests.mockResolvedValue(['req-letter'])
    const result = await service.exportSubject(as('ADMIN'), 'CONTACT', 'contact-3', NOW)
    expect(result.requestId).toBe('req-letter')
    expect(repo.completeOpenRequests).toHaveBeenCalledWith(tx, 'CONTACT', 'contact-3', 'EXPORT', NOW, expect.any(Object))
    expect(repo.createCompletedRequest).not.toHaveBeenCalled()
    expect(audit.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dsar.exported', objectType: 'Contact', objectId: 'contact-3' }),
    )
  })

  it('без письма регистрирует исполненный запрос канала ADMIN со сроком', async () => {
    const result = await service.exportSubject(as('ADMIN'), 'USER', 'user-7', NOW)
    expect(result.requestId).toBe('req-new')
    expect(repo.createCompletedRequest).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ channel: 'ADMIN', kind: 'EXPORT', requestedById: 'admin-1', dueAt: dueDate('EXPORT', NOW) }),
    )
  })

  it('в журнале и реестре — только числа, без ПД субъекта', async () => {
    await service.exportSubject(as('ADMIN'), 'USER', 'user-7', NOW)
    expect(auditText()).not.toContain(TARGET.email)
    expect(auditText()).not.toContain('Иванова')
    const summary = JSON.stringify(repo.createCompletedRequest.mock.calls[0]![1].summary)
    expect(summary).not.toContain(TARGET.email)
  })

  it('контакт: основание обработки берётся из учёта (решение 111)', async () => {
    const result = await service.exportSubject(as('ADMIN'), 'CONTACT', 'contact-3', NOW)
    expect(result.legalBasis[0]).toContain('Законный интерес')
    expect(result.auditTrail.byActor).toBeNull()
  })

  it('неизвестный субъект — 404, в реестр ничего', async () => {
    repo.findUserSubject.mockResolvedValue(null)
    await expect(service.exportSubject(as('ADMIN'), 'USER', 'nope', NOW)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(repo.createCompletedRequest).not.toHaveBeenCalled()
  })
})

describe('самостоятельная выгрузка', () => {
  it('раньше интервала — 409 с временем ожидания, без сборки', async () => {
    repo.findLastSelfExport.mockResolvedValue(new Date(NOW.getTime() - 4 * 60 * 1000))
    await expect(service.exportOwnData(as('VIEWER', 'user-7'), { address: null }, NOW)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { retryAfterSeconds: 360 },
    })
    expect(repo.loadSection).not.toHaveBeenCalled()
  })

  it('одновременное второе нажатие отклоняется под блокировкой', async () => {
    repo.withSelfExportLock.mockImplementation(async (_id: string, fn: (client: unknown, last: Date | null) => unknown) =>
      fn(tx, new Date(NOW.getTime() - 1000)),
    )
    await expect(service.exportOwnData(as('VIEWER', 'user-7'), { address: null }, NOW)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(repo.createCompletedRequest).not.toHaveBeenCalled()
  })

  it('регистрируется исполненным запросом SELF_SERVICE с адресом клиента', async () => {
    await service.exportOwnData(as('ANALYST', 'user-7'), { address: '10.0.0.5' }, NOW)
    expect(repo.createCompletedRequest).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ channel: 'SELF_SERVICE', subjectId: 'user-7', requestedById: 'user-7', ip: '10.0.0.5' }),
    )
    expect(audit.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'dsar.exported', userId: 'user-7' }))
  })
})

describe('обезличивание пользователя', () => {
  const facts = (overrides: Partial<{ target: typeof TARGET | null; otherActiveAdmins: number; openWork: { cooperations: number; stages: number } }> = {}) => ({
    target: TARGET,
    otherActiveAdmins: 1,
    openWork: { cooperations: 0, stages: 0 },
    ...overrides,
  })
  const withFacts = (value: ReturnType<typeof facts>) =>
    repo.withUserLock.mockImplementation(async (_id: string, fn: (client: unknown, f: unknown) => unknown) => fn(tx, value))

  beforeEach(() => {
    withFacts(facts())
    repo.applyErase.mockResolvedValue({
      profile: { action: 'redact', rows: 1 },
      telegramLink: { action: 'delete', rows: 1 },
      calendarFeed: { action: 'delete', rows: 0 },
      stages: { action: 'keep', rows: 4 },
    })
  })

  it('себя — 409 до базы', async () => {
    await expect(service.eraseUser(as('ADMIN', 'user-7'), 'user-7', { confirm: TARGET.email }, NOW)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(repo.withUserLock).not.toHaveBeenCalled()
  })

  it('неверное подтверждение — 422, ничего не меняется', async () => {
    await expect(service.eraseUser(as('ADMIN'), 'user-7', { confirm: 'other@example.invalid' }, NOW)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    expect(repo.applyErase).not.toHaveBeenCalled()
  })

  it('последний действующий администратор — 409', async () => {
    withFacts(facts({ target: { ...TARGET, role: 'ADMIN' }, otherActiveAdmins: 0 }))
    await expect(service.eraseUser(as('ADMIN'), 'user-7', { confirm: TARGET.email }, NOW)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(repo.applyErase).not.toHaveBeenCalled()
  })

  it('за сотрудником открытая работа — 409 с числами', async () => {
    withFacts(facts({ openWork: { cooperations: 2, stages: 1 } }))
    await expect(service.eraseUser(as('ADMIN'), 'user-7', { confirm: TARGET.email }, NOW)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { openCooperations: 2, openStages: 1 },
    })
  })

  it('общая демо-учётка — 409', async () => {
    withFacts(facts({ target: { ...TARGET, email: 'manager@skilllink.demo' } }))
    await expect(service.eraseUser(as('ADMIN'), 'user-7', { confirm: 'manager@skilllink.demo' }, NOW)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })

  it('неизвестный — 404', async () => {
    withFacts(facts({ target: null }))
    await expect(service.eraseUser(as('ADMIN'), 'nope', { confirm: 'x' }, NOW)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('по реестру в транзакции, запрос закрыт, журнал без ПД', async () => {
    repo.completeOpenRequests.mockResolvedValue(['req-letter'])
    const result = await service.eraseUser(as('ADMIN'), 'user-7', { confirm: ' IVANOVA@example.invalid ' }, NOW)

    expect(repo.applyErase).toHaveBeenCalledWith(tx, DSAR_REGISTRY.USER, { kind: 'USER', id: 'user-7', name: TARGET.fullName })
    expect(result).toMatchObject({ alreadyErased: false, requestId: 'req-letter', subject: { type: 'USER', id: 'user-7' } })
    const actions = audit.writeAudit.mock.calls.map((call) => call[0].action)
    expect(actions).toEqual(['telegram.unlink', 'user.block', 'dsar.erased'])
    // Всё — в той же транзакции.
    expect(audit.writeAudit.mock.calls.every((call) => call[1] === tx)).toBe(true)
    expect(auditText()).not.toContain(TARGET.email)
    expect(auditText()).not.toContain('Иванова')
  })

  it('уже обезличен — повтор без изменений, открытые запросы закрываются', async () => {
    withFacts(facts({ target: { ...TARGET, fullName: ERASED_USER_NAME, email: erasedUserEmail('user-7'), isActive: false } }))
    repo.completeOpenRequests.mockResolvedValue(['req-old'])
    const result = await service.eraseUser(as('ADMIN'), 'user-7', { confirm: 'что угодно' }, NOW)
    expect(result).toMatchObject({ alreadyErased: true, requestId: 'req-old' })
    expect(repo.applyErase).not.toHaveBeenCalled()
    expect(audit.writeAudit).not.toHaveBeenCalled()
  })
})

describe('обезличивание контакта', () => {
  beforeEach(() => {
    repo.withContactLock.mockImplementation(async (_id: string, fn: (client: unknown, c: unknown) => unknown) => fn(tx, CONTACT))
    repo.applyErase.mockResolvedValue({ profile: { action: 'redact', rows: 1 } })
  })

  it('подтверждение — ФИО контакта', async () => {
    await expect(service.eraseContact(as('ADMIN'), 'contact-3', { confirm: 'Другой Человек' }, NOW)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('тот же набор полей по реестру и та же запись contact.anonymize, что у карточки вуза', async () => {
    const result = await service.eraseContact(as('ADMIN'), 'contact-3', { confirm: 'ветрова ирина павловна' }, NOW)
    expect(repo.applyErase).toHaveBeenCalledWith(tx, DSAR_REGISTRY.CONTACT, expect.objectContaining({ kind: 'CONTACT', id: 'contact-3' }))
    expect(result.alreadyErased).toBe(false)
    expect(audit.writeAudit.mock.calls.map((call) => call[0].action)).toEqual(['contact.anonymize', 'dsar.erased'])
    expect(auditText()).not.toContain('Ветрова')
    expect(auditText()).not.toContain(CONTACT.email)
    const profile = DSAR_REGISTRY.CONTACT.find((entry) => entry.section === 'profile')!
    expect(profile.redact!({ kind: 'CONTACT', id: 'c', name: null })).toMatchObject({ fullName: ANONYMIZED_CONTACT_NAME, email: null, phone: null })
  })
})

describe('реестр запросов', () => {
  it('письмо: срок от даты получения, запись в журнал без ПД', async () => {
    const receivedAt = '2026-09-24T10:00:00.000Z'
    repo.findOpenRequest.mockResolvedValue(null)
    repo.createRequest.mockImplementation(async (data: Record<string, unknown>) => ({
      id: 'req-1',
      status: 'OPEN',
      completedAt: null,
      summary: null,
      requestedBy: { id: 'admin-1', fullName: 'Админ', role: 'ADMIN' },
      ...data,
    }))
    const result = await service.registerRequest(as('ADMIN'), { subjectType: 'CONTACT', subjectId: 'contact-3', kind: 'ERASE', receivedAt }, NOW)
    expect(repo.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'LETTER', requestedAt: new Date(receivedAt), dueAt: dueDate('ERASE', new Date(receivedAt)) }),
    )
    expect(result).toMatchObject({ id: 'req-1', overdue: false, kind: 'ERASE' })
    expect(audit.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'dsar.requested', objectType: 'Contact' }))
    expect(auditText()).not.toContain('Ветрова')
  })

  it('дата в будущем и старше 30 дней — 422', async () => {
    const base = { subjectType: 'USER' as const, subjectId: 'user-7', kind: 'EXPORT' as const }
    await expect(service.registerRequest(as('ADMIN'), { ...base, receivedAt: '2026-09-26T00:00:00Z' }, NOW)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(service.registerRequest(as('ADMIN'), { ...base, receivedAt: '2026-08-01T00:00:00Z' }, NOW)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('несуществующий субъект — 422, повтор открытого — 409 с номером', async () => {
    repo.findUserSubject.mockResolvedValueOnce(null)
    await expect(
      service.registerRequest(as('ADMIN'), { subjectType: 'USER', subjectId: 'nope', kind: 'EXPORT' }, NOW),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    repo.findOpenRequest.mockResolvedValue({ id: 'req-open' })
    await expect(
      service.registerRequest(as('ADMIN'), { subjectType: 'USER', subjectId: 'user-7', kind: 'EXPORT' }, NOW),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { requestId: 'req-open' } })
    expect(repo.createRequest).not.toHaveBeenCalled()
  })

  it('открытый с прошедшим сроком — overdue', async () => {
    repo.listRequests.mockResolvedValue({
      total: 1,
      rows: [
        {
          id: 'r', subjectType: 'USER', subjectId: 'u', kind: 'EXPORT', channel: 'LETTER', status: 'OPEN',
          requestedAt: new Date('2026-09-01T00:00:00Z'), dueAt: new Date('2026-09-15T00:00:00Z'), completedAt: null,
          summary: null, requestedBy: { id: 'admin-1', fullName: 'Админ', role: 'ADMIN' },
        },
      ],
    })
    const result = await service.listRequests(as('ADMIN'), { page: 1, pageSize: 20 }, NOW)
    expect(result.data[0]).toMatchObject({ overdue: true, completedAt: null })
    expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 1 })
  })
})
