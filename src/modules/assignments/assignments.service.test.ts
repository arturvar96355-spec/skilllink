import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectRejectCode } from '@/shared/testing/expect-code'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'

/**
 * Поручения (решение 207): права по ролям и полям, эксперт, просрочка в списке,
 * уведомление новому исполнителю. Сервис — настоящий; подменены репозиторий,
 * журнал и канал (`sendToUser`).
 */
const repo = vi.hoisted(() => ({
  findMany: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  findAssignableUser: vi.fn(),
  findCooperationUniversity: vi.fn(),
  universityExists: vi.fn(),
}))
vi.mock('./assignments.repo', () => repo)

const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }))
vi.mock('@/shared/audit/audit', () => audit)

const channels = vi.hoisted(() => ({ sendToUser: vi.fn() }))
vi.mock('@/modules/notify-channels/notify-channels.service', () => channels)

const service = await import('./assignments.service')

// Воскресенье 27.09.2026, 12:00 по Москве.
const NOW = new Date('2026-09-27T09:00:00.000Z')

function person(id: string, role: UserRole, isReviewer = false): CurrentUser {
  return { id, email: `${id}@test.local`, fullName: id, role, universityId: null, isReviewer }
}

const head = person('head', 'HEAD')
const admin = person('admin', 'ADMIN')
const manager = person('manager', 'MANAGER')
const otherManager = person('manager2', 'MANAGER')

function row(partial: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    assigneeId: 'manager',
    authorId: 'head',
    text: 'Позвонить в МТУСИ до пятницы',
    universityId: 'uni-1',
    cooperationId: null,
    dueAt: new Date('2026-10-02T00:00:00.000Z'),
    priority: 'NORMAL',
    status: 'NEW',
    doneAt: null,
    isMock: false,
    createdAt: NOW,
    updatedAt: NOW,
    assignee: { id: 'manager', fullName: 'Кириллов Пётр Андреевич' },
    author: { id: 'head', fullName: 'Тимофеев Аркадий Семёнович' },
    university: { id: 'uni-1', name: 'Московский технический университет связи и информатики', shortName: 'МТУСИ' },
    cooperation: null,
    ...partial,
  }
}

const input = { assigneeId: 'manager', text: 'Позвонить в МТУСИ до пятницы', dueDate: '2026-10-02', priority: 'NORMAL' as const }

/** Отправка идёт в фоне (ответ её не ждёт) — дать ей закончиться. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.clearAllMocks()
  repo.findAssignableUser.mockResolvedValue({ id: 'manager', fullName: 'Кириллов Пётр Андреевич' })
  repo.universityExists.mockResolvedValue(true)
  repo.create.mockImplementation(async (data: Record<string, unknown>) => row({ ...data, id: 'a1' }))
  repo.findById.mockResolvedValue(row())
  repo.update.mockImplementation(async (_id: string, data: Record<string, unknown>) => row(data))
  repo.findMany.mockResolvedValue({ rows: [row()], total: 1 })
  channels.sendToUser.mockResolvedValue({ sent: true, channel: 'telegram' })
})

afterEach(() => {
  delete process.env.AUTH_URL
})

describe('кто даёт поручение', () => {
  it.each([head, admin])('%s — может', async (user) => {
    const dto = await service.create(user, { ...input, universityId: 'uni-1' }, NOW)
    expect(dto).toMatchObject({ status: 'NEW', dueDate: '2026-10-02', dueState: 'later', canEdit: true })
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ authorId: user.id, assigneeId: 'manager' }))
    expect(audit.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assignment.create', objectType: 'Assignment', objectId: 'a1' }),
    )
  })

  it.each<UserRole>(['MANAGER', 'ANALYST', 'VIEWER', 'UNIVERSITY_REP'])('%s — 403, в базу не пишем', async (role) => {
    await expectRejectCode(service.create(person('x', role), input, NOW), 'FORBIDDEN')
    expect(repo.create).not.toHaveBeenCalled()
  })

  it.each<UserRole>(['ADMIN', 'HEAD'])('эксперт с ролью %s — 403, как на все изменения', async (role) => {
    await expectRejectCode(service.create(person('expert', role, true), input, NOW), 'FORBIDDEN')
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('срок в прошлом — отказ по полю dueDate; сегодня — можно', async () => {
    const error = await service.create(head, { ...input, dueDate: '2026-09-26' }, NOW).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ field: 'dueDate' }] })
    await expect(service.create(head, { ...input, dueDate: '2026-09-27' }, NOW)).resolves.toMatchObject({ dueState: 'today' })
  })

  it('исполнитель — только действующий сотрудник ИТ-Школы', async () => {
    repo.findAssignableUser.mockResolvedValue(null)
    const error = await service.create(head, { ...input, assigneeId: 'rep' }, NOW).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ field: 'assigneeId' }] })
  })

  it('связка чужого вуза — отказ; без вуза вуз берётся из связки', async () => {
    repo.findCooperationUniversity.mockResolvedValue({ id: 'coop-1', universityId: 'uni-2' })
    await expectRejectCode(
      service.create(head, { ...input, universityId: 'uni-1', cooperationId: 'coop-1' }, NOW),
      'VALIDATION_ERROR',
    )
    await service.create(head, { ...input, cooperationId: 'coop-1' }, NOW)
    expect(repo.create).toHaveBeenLastCalledWith(expect.objectContaining({ universityId: 'uni-2', cooperationId: 'coop-1' }))
  })
})

describe('уведомление новому исполнителю', () => {
  it('после записи уходит в канал: без текста поручения, с кнопкой «Открыть поручение»', async () => {
    process.env.AUTH_URL = 'https://skilllink.example'
    await service.create(head, { ...input, universityId: 'uni-1', priority: 'HIGH' }, NOW)
    await settle()
    expect(channels.sendToUser).toHaveBeenCalledTimes(1)
    const [userId, message] = channels.sendToUser.mock.calls[0]!
    expect(userId).toBe('manager')
    expect(message.text).toContain('МТУСИ')
    expect(message.text).not.toContain('Позвонить')
    expect(message.text).not.toContain('Тимофеев')
    expect(message.actions[0][0]).toMatchObject({ kind: 'open', text: 'Открыть поручение' })
    expect(message.actions[0][0].url).toBe('https://skilllink.example/profile?assignment=a1#my-assignments')
  })

  it('поручение себе — без уведомления', async () => {
    repo.create.mockImplementation(async (data: Record<string, unknown>) => row({ ...data, assigneeId: 'head' }))
    await service.create(head, { ...input, assigneeId: 'head' }, NOW)
    await settle()
    expect(channels.sendToUser).not.toHaveBeenCalled()
  })

  it('сбой мессенджера не ломает создание', async () => {
    channels.sendToUser.mockRejectedValue(new Error('сеть недоступна'))
    await expect(service.create(head, input, NOW)).resolves.toMatchObject({ id: 'a1' })
    await settle()
    expect(repo.create).toHaveBeenCalledTimes(1)
  })

  it('смена исполнителя автором — уведомление новому; смена статуса — никому', async () => {
    repo.findAssignableUser.mockResolvedValue({ id: 'manager2', fullName: 'Савельева' })
    await service.update(head, 'a1', { assigneeId: 'manager2' }, NOW)
    await settle()
    expect(channels.sendToUser).toHaveBeenCalledWith('manager2', expect.anything())

    channels.sendToUser.mockClear()
    await service.update(manager, 'a1', { status: 'IN_PROGRESS' }, NOW)
    await settle()
    expect(channels.sendToUser).not.toHaveBeenCalled()
  })
})

describe('кто меняет поручение', () => {
  it('исполнитель меняет статус одной кнопкой; «Сделано» ставит дату выполнения, в журнал — assignment.status', async () => {
    // «Сделано» — из «В работе»: NEW → DONE напрямую запрещено (решение 225).
    repo.findById.mockResolvedValue(row({ status: 'IN_PROGRESS' }))
    const dto = await service.update(manager, 'a1', { status: 'DONE' }, NOW)
    expect(repo.update).toHaveBeenCalledWith('a1', { status: 'DONE', doneAt: NOW })
    expect(dto).toMatchObject({ status: 'DONE', dueState: 'done', canEdit: false, canChangeStatus: true })
    expect(audit.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assignment.status', payload: { from: 'IN_PROGRESS', to: 'DONE' } }),
    )
  })

  it('возврат в работу снимает дату выполнения', async () => {
    repo.findById.mockResolvedValue(row({ status: 'DONE', doneAt: NOW }))
    await service.update(manager, 'a1', { status: 'IN_PROGRESS' }, NOW)
    expect(repo.update).toHaveBeenCalledWith('a1', { status: 'IN_PROGRESS', doneAt: null })
  })

  it('исполнитель не меняет текст, срок и важность — 403', async () => {
    for (const change of [{ text: 'Другое' }, { dueDate: '2026-10-09' }, { priority: 'HIGH' as const }, { assigneeId: 'x' }]) {
      await expectRejectCode(service.update(manager, 'a1', change, NOW), 'FORBIDDEN')
    }
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('автор меняет всё; в журнал — какие поля', async () => {
    await service.update(head, 'a1', { text: 'Позвонить в МТУСИ до четверга', dueDate: '2026-10-01', status: 'IN_PROGRESS' }, NOW)
    expect(repo.update).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ text: 'Позвонить в МТУСИ до четверга', status: 'IN_PROGRESS', doneAt: null }),
    )
    expect(audit.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'assignment.update',
        payload: expect.objectContaining({ fields: ['text', 'dueDate', 'status'], from: 'NEW', to: 'IN_PROGRESS' }),
      }),
    )
  })

  it('другой руководитель (не автор) — 403 и на текст, и на статус', async () => {
    const otherHead = person('head2', 'HEAD')
    await expectRejectCode(service.update(otherHead, 'a1', { text: 'Другое' }, NOW), 'FORBIDDEN')
    await expectRejectCode(service.update(otherHead, 'a1', { status: 'DONE' }, NOW), 'FORBIDDEN')
  })

  it('чужое поручение для сотрудника, который видит только свои, — 404, а не 403', async () => {
    await expectRejectCode(service.update(otherManager, 'a1', { status: 'DONE' }, NOW), 'NOT_FOUND')
  })

  it('эксперт — 403, даже если поручение на нём', async () => {
    repo.findById.mockResolvedValue(row({ assigneeId: 'expert' }))
    await expectRejectCode(service.update(person('expert', 'MANAGER', true), 'a1', { status: 'DONE' }, NOW), 'FORBIDDEN')
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('перенос срока в прошлое — отказ; прежний срок в прошлом можно не трогать', async () => {
    await expectRejectCode(service.update(head, 'a1', { dueDate: '2026-09-20' }, NOW), 'VALIDATION_ERROR')
    repo.findById.mockResolvedValue(row({ dueAt: new Date('2026-09-20T00:00:00.000Z') }))
    await expect(service.update(head, 'a1', { dueDate: '2026-09-20', priority: 'HIGH' }, NOW)).resolves.toBeDefined()
  })
})

/**
 * Переходы статуса (решение 225, находка Codex 14): прямым PATCH раньше проходили
 * NEW → DONE и DONE → NEW, хотя интерфейс ведёт NEW → IN_PROGRESS → DONE → IN_PROGRESS
 * (`nextStatusAction`). Повтор того же статуса — не переход: 200 без изменений
 * (двойной клик «Сделано» не должен давать ошибку).
 */
describe('переходы статуса поручения', () => {
  const PREVIOUS_DONE_AT = new Date('2026-09-25T10:00:00.000Z')

  const ALLOWED = [
    { from: 'NEW', to: 'IN_PROGRESS', doneAt: null },
    { from: 'IN_PROGRESS', to: 'DONE', doneAt: NOW },
    { from: 'DONE', to: 'IN_PROGRESS', doneAt: null },
    { from: 'NEW', to: 'NEW', doneAt: null },
    { from: 'IN_PROGRESS', to: 'IN_PROGRESS', doneAt: null },
    { from: 'DONE', to: 'DONE', doneAt: PREVIOUS_DONE_AT },
  ] as const

  const FORBIDDEN = [
    { from: 'NEW', to: 'DONE' },
    { from: 'IN_PROGRESS', to: 'NEW' },
    { from: 'DONE', to: 'NEW' },
  ] as const

  it.each(ALLOWED)('$from → $to — разрешён, doneAt = $doneAt', async ({ from, to, doneAt }) => {
    repo.findById.mockResolvedValue(row({ status: from, doneAt: from === 'DONE' ? PREVIOUS_DONE_AT : null }))
    for (const actor of [manager, head]) {
      repo.update.mockClear()
      const dto = await service.update(actor, 'a1', { status: to }, NOW)
      expect(repo.update).toHaveBeenCalledWith('a1', { status: to, doneAt })
      expect(dto.status).toBe(to)
    }
  })

  it.each(FORBIDDEN)('$from → $to — 409 INVALID_TRANSITION, запись, doneAt и журнал не меняются', async ({ from, to }) => {
    repo.findById.mockResolvedValue(row({ status: from, doneAt: from === 'DONE' ? PREVIOUS_DONE_AT : null }))
    for (const actor of [manager, head]) {
      const error = await service.update(actor, 'a1', { status: to }, NOW).catch((caught: unknown) => caught)
      expect(error).toMatchObject({ code: 'INVALID_TRANSITION', status: 409 })
      expect((error as Error).message).toMatch(/^Поручение нельзя перевести из «/)
    }
    expect(repo.update).not.toHaveBeenCalled()
    expect(audit.writeAudit).not.toHaveBeenCalled()
    expect(channels.sendToUser).not.toHaveBeenCalled()
  })

  it('все девять пар покрыты', () => {
    expect(ALLOWED.length + FORBIDDEN.length).toBe(9)
  })

  it('автор с правкой текста и запрещённым статусом — 409, текст тоже не записан', async () => {
    await expectRejectCode(service.update(head, 'a1', { text: 'Другое', status: 'DONE' }, NOW), 'INVALID_TRANSITION')
    expect(repo.update).not.toHaveBeenCalled()
  })
})

describe('список', () => {
  it('сотрудник видит только свои: фильтр подставляется сервером', async () => {
    await service.list(manager, { page: 1, pageSize: 20 }, NOW)
    expect(repo.findMany).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: 'manager' }), expect.anything())
  })

  it('чужие — 403 сотруднику; руководителю и эксперту — можно', async () => {
    await expectRejectCode(service.list(manager, { page: 1, pageSize: 20, assigneeId: 'manager2' }, NOW), 'FORBIDDEN')
    await service.list(head, { page: 1, pageSize: 20, assigneeId: 'manager2' }, NOW)
    expect(repo.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ assigneeId: 'manager2' }), expect.anything())
    await service.list(person('expert', 'MANAGER', true), { page: 1, pageSize: 20, assigneeId: 'manager2' }, NOW)
    expect(repo.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ assigneeId: 'manager2' }), expect.anything())
  })

  it('руководитель без фильтра видит все', async () => {
    await service.list(head, { page: 1, pageSize: 20 }, NOW)
    expect(repo.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ assigneeId: undefined }), expect.anything())
  })

  it('представителю вуза — 403', async () => {
    await expectRejectCode(service.list(person('rep', 'UNIVERSITY_REP'), { page: 1, pageSize: 20 }, NOW), 'FORBIDDEN')
  })

  it('overdue=true — срок раньше сегодняшней московской даты', async () => {
    await service.list(head, { page: 1, pageSize: 20, overdue: true }, NOW)
    expect(repo.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ overdueBefore: new Date('2026-09-27T00:00:00.000Z') }),
      expect.anything(),
    )
  })

  it('просроченное поручение помечено в строке: dueState и дни', async () => {
    repo.findMany.mockResolvedValue({ rows: [row({ dueAt: new Date('2026-09-25T00:00:00.000Z'), status: 'IN_PROGRESS' })], total: 1 })
    const { data } = await service.list(manager, { page: 1, pageSize: 20 }, NOW)
    expect(data[0]).toMatchObject({ dueState: 'overdue', daysOverdue: 2, canChangeStatus: true, canEdit: false })
  })
})
