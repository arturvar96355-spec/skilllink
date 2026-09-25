import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { CooperationStatus, StageStatus, UserRole } from '@/shared/contracts/enums'
import { CONTROL_STAGE_NUMBER, WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import { expectRejectCode } from '@/shared/testing/expect-code'
import { computeControlStatus, UNIVERSITY_ITEM_FORBIDDEN_MESSAGE } from './workflow.rules'

/**
 * Сервис этапов (аудит K-41): отметка пункта чек-листа и смена статуса этапа.
 *
 * База подменена маленькой моделью в памяти — связка, её 14 этапов и пункты чек-листа:
 * сервис и репозиторий работают по-настоящему, проверяется, что уходит в базу,
 * в историю и в журнал и что отказы не доходят до записи. Рекомендации и журнал подменены.
 */
interface FakeStage {
  id: string
  stageNumber: number
  title: string
  status: StageStatus
  result: string | null
  blockingReason: string | null
  startedAt: Date | null
  completedAt: Date | null
  completedById: string | null
}

interface FakeTask {
  id: string
  stageId: string
  title: string
  isRequired: boolean
  isUniversityItem: boolean
  isDone: boolean
  doneAt: Date | null
  doneById: string | null
  confirmationNote: string | null
}

const db = {
  cooperation: { id: 'coop-1', universityId: 'uni-1', status: 'ACTIVE' as CooperationStatus },
  stages: [] as FakeStage[],
  tasks: [] as FakeTask[],
  hasRep: false,
}

const mocks = vi.hoisted(() => ({
  cooperation: { findUnique: vi.fn() },
  workflowStage: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  task: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
  user: { findFirst: vi.fn() },
  stageHistory: { create: vi.fn() },
  queryRaw: vi.fn(),
  writeAudit: vi.fn(),
  syncRecommendations: vi.fn(),
}))

vi.mock('@/shared/db/prisma', () => {
  const client = {
    cooperation: mocks.cooperation,
    workflowStage: mocks.workflowStage,
    task: mocks.task,
    user: mocks.user,
    stageHistory: mocks.stageHistory,
    $queryRaw: mocks.queryRaw,
  }
  return { prisma: { ...client, $transaction: (fn: (tx: typeof client) => unknown) => fn(client) } }
})
vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))
vi.mock('@/modules/recommendations/recommendations.service', () => ({
  syncCooperation: mocks.syncRecommendations,
}))

const service = await import('./workflow.service')

const as = (role: UserRole, id = `${role.toLowerCase()}-1`): CurrentUser => ({
  id,
  email: `${id}@example.invalid`,
  fullName: 'Тестовый Пользователь',
  role,
  universityId: role === 'UNIVERSITY_REP' ? 'uni-1' : null,
})

const MANAGER = as('MANAGER')

function stageOf(stageNumber: number): FakeStage {
  const stage = db.stages.find((row) => row.stageNumber === stageNumber)
  if (!stage) throw new Error(`нет этапа ${stageNumber}`)
  return stage
}

function taskOf(id: string): FakeTask {
  const task = db.tasks.find((row) => row.id === id)
  if (!task) throw new Error(`нет пункта ${id}`)
  return task
}

/** Строка этапа в форме `stageSelect` репозитория. */
function stageRow(stage: FakeStage) {
  return {
    id: stage.id,
    cooperationId: db.cooperation.id,
    stageNumber: stage.stageNumber,
    title: stage.title,
    phase: 'IMPLEMENTATION',
    status: stage.status,
    deadline: null,
    comment: null,
    result: stage.result,
    blockingReason: stage.blockingReason,
    startedAt: stage.startedAt,
    completedAt: stage.completedAt,
    updatedAt: new Date('2026-09-20T10:00:00Z'),
    responsible: null,
    completedBy: null,
    tasks: db.tasks
      .filter((task) => task.stageId === stage.id)
      .map((task, index) => ({
        id: task.id,
        title: task.title,
        isRequired: task.isRequired,
        isDone: task.isDone,
        doneAt: task.doneAt,
        sortOrder: index,
        isUniversityItem: task.isUniversityItem,
        confirmationNote: task.confirmationNote,
        doneBy: null,
      })),
    cooperation: { university: { users: db.hasRep ? [{ id: 'rep-1' }] : [] } },
  }
}

/**
 * Связка с 14 этапами. По умолчанию: 1–6 завершены (договор подписан), 7 в работе,
 * дальше не начаты; этап 14 — как его посчитала бы система.
 */
function seed(statuses: Partial<Record<number, StageStatus>> = {}): void {
  db.cooperation = { id: 'coop-1', universityId: 'uni-1', status: 'ACTIVE' }
  db.hasRep = false
  db.stages = WORKFLOW_STAGES.map((definition) => {
    const status: StageStatus =
      statuses[definition.number] ??
      (definition.number <= 6 ? 'COMPLETED' : definition.number === 7 ? 'IN_PROGRESS' : 'NOT_STARTED')
    return {
      id: `stage-${definition.number}`,
      stageNumber: definition.number,
      title: definition.title,
      status,
      result: status === 'COMPLETED' ? 'Результат зафиксирован' : null,
      blockingReason: status === 'BLOCKED' ? 'Причина' : null,
      startedAt: status === 'NOT_STARTED' ? null : new Date('2026-09-01T00:00:00Z'),
      completedAt: null,
      completedById: null,
    }
  })
  const control = stageOf(CONTROL_STAGE_NUMBER)
  control.status = computeControlStatus(
    db.stages.filter((stage) => stage !== control).map((stage) => stage.status),
  )

  const task = (id: string, stageNumber: number, title: string, extra: Partial<FakeTask> = {}): FakeTask => ({
    id,
    stageId: `stage-${stageNumber}`,
    title,
    isRequired: true,
    isUniversityItem: false,
    isDone: false,
    doneAt: null,
    doneById: null,
    confirmationNote: null,
    ...extra,
  })
  db.tasks = [
    task('task-materials', 7, 'Переданы учебные материалы'),
    task('task-license', 7, 'Передана лицензия на IT-продукт'),
    task('task-uni', 7, 'Вуз подтвердил получение материалов', { isUniversityItem: true }),
    task('task-support', 8, 'Проведена консультация по внедрению'),
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  seed()

  mocks.cooperation.findUnique.mockImplementation(async () => ({
    universityId: db.cooperation.universityId,
    status: db.cooperation.status,
  }))
  mocks.workflowStage.findUnique.mockImplementation(async ({ where }) => {
    const stage = where.id
      ? db.stages.find((row) => row.id === where.id)
      : db.stages.find((row) => row.stageNumber === where.cooperationId_stageNumber?.stageNumber)
    return stage ? stageRow(stage) : null
  })
  mocks.workflowStage.findMany.mockImplementation(async ({ where }) =>
    db.stages
      .filter((stage) => (where.stageNumber?.lt === undefined ? true : stage.stageNumber < where.stageNumber.lt))
      .filter((stage) => (where.stageNumber?.gt === undefined ? true : stage.stageNumber > where.stageNumber.gt))
      .map((stage) => ({ id: stage.id, stageNumber: stage.stageNumber, title: stage.title, status: stage.status })),
  )
  mocks.workflowStage.updateMany.mockImplementation(async ({ where, data }) => {
    const stage = db.stages.find((row) => row.id === where.id && row.status === where.status)
    if (!stage) return { count: 0 }
    Object.assign(stage, data)
    return { count: 1 }
  })
  mocks.workflowStage.update.mockImplementation(async ({ where, data }) => {
    Object.assign(db.stages.find((row) => row.id === where.id)!, data)
    return {}
  })
  mocks.task.findUnique.mockImplementation(async ({ where }) => {
    const task = db.tasks.find((row) => row.id === where.id)
    if (!task) return null
    const stage = db.stages.find((row) => row.id === task.stageId)!
    return {
      ...task,
      stage: {
        id: stage.id,
        status: stage.status,
        stageNumber: stage.stageNumber,
        cooperationId: db.cooperation.id,
        cooperation: { universityId: db.cooperation.universityId },
      },
    }
  })
  mocks.task.update.mockImplementation(async ({ where, data }) => {
    Object.assign(taskOf(where.id), data)
    return {}
  })
  mocks.task.count.mockImplementation(
    async ({ where }) =>
      db.tasks.filter(
        (task) => task.stageId === where.stageId && task.isRequired === where.isRequired && task.isDone === where.isDone,
      ).length,
  )
  mocks.user.findFirst.mockImplementation(async () => (db.hasRep ? { id: 'rep-1' } : null))
  mocks.stageHistory.create.mockResolvedValue({})
  mocks.queryRaw.mockResolvedValue([])
})

/** Ничего не записано: ни пункт, ни этап, ни история, ни журнал. */
function expectNothingWritten(): void {
  expect(mocks.task.update).not.toHaveBeenCalled()
  expect(mocks.workflowStage.updateMany).not.toHaveBeenCalled()
  expect(mocks.workflowStage.update).not.toHaveBeenCalled()
  expect(mocks.stageHistory.create).not.toHaveBeenCalled()
  expect(mocks.writeAudit).not.toHaveBeenCalled()
  expect(mocks.syncRecommendations).not.toHaveBeenCalled()
}

describe('toggleTask: пункт вуза (решение 103)', () => {
  const NOTE = 'письмо от 12.09 от Тестовой Т. Т., тел. +7 900 000-00-00'

  it.each(['ADMIN', 'MANAGER'] as const)(
    'при действующем представителе %s получает 403 и на отметку, и на снятие',
    async (role) => {
      db.hasRep = true
      await expect(
        service.toggleTask(as(role), 'task-uni', { isDone: true, confirmationNote: NOTE }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: UNIVERSITY_ITEM_FORBIDDEN_MESSAGE })

      Object.assign(taskOf('task-uni'), { isDone: true, doneById: 'rep-1' })
      await expectRejectCode(service.toggleTask(as(role), 'task-uni', { isDone: false }), 'FORBIDDEN')

      // Отказ — до очереди связки и до записи: подтверждение вуза не тронуто.
      expect(mocks.queryRaw).not.toHaveBeenCalled()
      expect(taskOf('task-uni').doneById).toBe('rep-1')
      expectNothingWritten()
    },
  )

  it('без представителя отметка без пометки — 422 по полю confirmationNote', async () => {
    for (const confirmationNote of [undefined, null, '   ']) {
      await expect(
        service.toggleTask(MANAGER, 'task-uni', { isDone: true, confirmationNote }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [expect.objectContaining({ field: 'confirmationNote' })],
      })
    }
    expect(taskOf('task-uni').isDone).toBe(false)
    expectNothingWritten()
  })

  it('без представителя с пометкой — отмечено, пометка в пункте, в журнале только её длина', async () => {
    const dto = await service.toggleTask(MANAGER, 'task-uni', {
      isDone: true,
      confirmationNote: `  ${NOTE}  `,
    })

    expect(mocks.task.update).toHaveBeenCalledTimes(1)
    expect(mocks.task.update.mock.calls[0]![0].data).toMatchObject({
      isDone: true,
      doneById: MANAGER.id,
      confirmationNote: NOTE,
    })
    // Запись — в очереди связки (lockCooperation), как смена статуса.
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1)

    expect(mocks.writeAudit).toHaveBeenCalledTimes(1)
    expect(mocks.writeAudit).toHaveBeenCalledWith({
      userId: MANAGER.id,
      action: 'task.university-item.confirm-by-staff',
      objectType: 'Task',
      objectId: 'task-uni',
      payload: { isDone: true, stageId: 'stage-7', stageNumber: 7, noteLength: NOTE.length },
    })
    // Свободный текст с ФИО и телефоном в журнал не попадает.
    const logged = JSON.stringify(mocks.writeAudit.mock.calls)
    expect(logged).not.toContain('Тестовой')
    expect(logged).not.toContain('+7 900')
    expect(mocks.syncRecommendations).toHaveBeenCalledWith('coop-1')

    // Ответ — этап целиком; сотрудник видит пометку.
    const item = dto.tasks.find((task) => task.id === 'task-uni')!
    expect(item).toMatchObject({ isDone: true, confirmationNote: NOTE, staffMarkRule: 'NOTE_REQUIRED' })
    expect(dto.requiredTasksDone).toBe(1)
  })

  it('снятие отметки без представителя — без пометки, пометка стирается', async () => {
    Object.assign(taskOf('task-uni'), { isDone: true, doneById: 'manager-1', confirmationNote: NOTE })

    await service.toggleTask(MANAGER, 'task-uni', { isDone: false })

    expect(mocks.task.update.mock.calls[0]![0].data).toEqual({
      isDone: false,
      doneAt: null,
      doneById: null,
      confirmationNote: null,
    })
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.toggle', payload: { isDone: false, stageId: 'stage-7' } }),
    )
  })

  it('у обычного пункта пометка не хранится, даже если её прислали', async () => {
    await service.toggleTask(MANAGER, 'task-materials', { isDone: true, confirmationNote: NOTE })

    expect(mocks.task.update.mock.calls[0]![0].data).toMatchObject({ isDone: true, confirmationNote: null })
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.toggle', payload: { isDone: true, stageId: 'stage-7' } }),
    )
    expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain('Тестовой')
  })

  it('представитель вуза этой дорогой не ходит: нет права WRITE — 403 до базы', async () => {
    await expectRejectCode(
      service.toggleTask(as('UNIVERSITY_REP'), 'task-uni', { isDone: true }),
      'FORBIDDEN',
    )
    expect(mocks.task.findUnique).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it('повторная отметка уже отмеченного — без ошибки и без записи в журнал', async () => {
    Object.assign(taskOf('task-materials'), { isDone: true, doneById: 'admin-1' })

    const dto = await service.toggleTask(MANAGER, 'task-materials', { isDone: true })

    // Автор первой отметки не переписан менеджером с устаревшей страницы.
    expect(taskOf('task-materials').doneById).toBe('admin-1')
    expect(dto.tasks.find((task) => task.id === 'task-materials')!.isDone).toBe(true)
    expectNothingWritten()
  })
})

describe('toggleTask: закрытая связка и закрытый этап', () => {
  it.each(['COMPLETED', 'CANCELLED'] as const)('связка %s — 409 CONFLICT, пункт не меняется', async (status) => {
    db.cooperation.status = status
    await expectRejectCode(service.toggleTask(MANAGER, 'task-materials', { isDone: true }), 'CONFLICT')

    expect(taskOf('task-materials').isDone).toBe(false)
    expect(mocks.queryRaw).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it('пункт завершённого этапа не снимается — 409 CONFLICT', async () => {
    stageOf(7).status = 'COMPLETED'
    Object.assign(taskOf('task-materials'), { isDone: true })

    await expectRejectCode(service.toggleTask(MANAGER, 'task-materials', { isDone: false }), 'CONFLICT')
    expect(taskOf('task-materials').isDone).toBe(true)
    expectNothingWritten()
  })

  it('несуществующий пункт — 404, до записи не доходит', async () => {
    await expectRejectCode(service.toggleTask(MANAGER, 'task-missing', { isDone: true }), 'NOT_FOUND')
    expectNothingWritten()
  })
})

describe('toggleTask: контрольная точка не пускает в чек-лист этапа 7 до подписания', () => {
  it.each(['IN_PROGRESS', 'CANCELLED', 'NOT_STARTED'] as const)(
    'этап 6 %s — пункт этапа 7 не отмечается (409 INVALID_TRANSITION)',
    async (signing) => {
      seed({ 6: signing, 7: 'NOT_STARTED' })

      await expect(
        service.toggleTask(MANAGER, 'task-license', { isDone: true }),
      ).rejects.toMatchObject({
        code: 'INVALID_TRANSITION',
        details: {
          stageNumber: 7,
          isControlPoint: true,
          blockingStages: [expect.objectContaining({ stageNumber: 6, status: signing })],
        },
      })
      // Проверка — под блокировкой связки, и до записи дело не дошло.
      expect(mocks.queryRaw).toHaveBeenCalledTimes(1)
      expect(taskOf('task-license').isDone).toBe(false)
      expectNothingWritten()
    },
  )

  it('пункт вуза с пометкой тоже не отмечается до подписания', async () => {
    seed({ 6: 'IN_PROGRESS', 7: 'NOT_STARTED' })
    await expectRejectCode(
      service.toggleTask(MANAGER, 'task-uni', { isDone: true, confirmationNote: 'письмо от 12.09' }),
      'INVALID_TRANSITION',
    )
    expectNothingWritten()
  })

  it('этап 8 ждёт завершения этапа 7', async () => {
    seed({ 7: 'IN_PROGRESS', 8: 'NOT_STARTED' })
    await expect(service.toggleTask(MANAGER, 'task-support', { isDone: true })).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { stageNumber: 8, isControlPoint: false, blockingStages: [expect.objectContaining({ stageNumber: 7 })] },
    })
  })

  it('снять отметку можно всегда — это не утверждение о работе', async () => {
    seed({ 6: 'IN_PROGRESS', 7: 'NOT_STARTED' })
    Object.assign(taskOf('task-license'), { isDone: true, doneById: 'manager-1' })

    await service.toggleTask(MANAGER, 'task-license', { isDone: false })

    expect(taskOf('task-license').isDone).toBe(false)
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'task.toggle' }))
  })

  it('после подписания (этап 6 завершён) пункт этапа 7 отмечается', async () => {
    await service.toggleTask(MANAGER, 'task-license', { isDone: true })
    expect(taskOf('task-license')).toMatchObject({ isDone: true, doneById: MANAGER.id })
  })
})

describe('updateStage: смена статуса этапа', () => {
  it('IN_PROGRESS → BLOCKED: запись истории, журнал, сверка рекомендаций', async () => {
    seed({ 3: 'IN_PROGRESS' })

    const dto = await service.updateStage(MANAGER, 'stage-3', {
      status: 'BLOCKED',
      blockingReason: 'Ждём ответ юридической службы вуза',
    })

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1)
    expect(mocks.stageHistory.create).toHaveBeenCalledTimes(1)
    expect(mocks.stageHistory.create).toHaveBeenCalledWith({
      data: {
        stageId: 'stage-3',
        fromStatus: 'IN_PROGRESS',
        toStatus: 'BLOCKED',
        comment: 'Ждём ответ юридической службы вуза',
        changedById: MANAGER.id,
      },
    })
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1)
    expect(mocks.writeAudit).toHaveBeenCalledWith({
      userId: MANAGER.id,
      action: 'stage.status.change',
      objectType: 'WorkflowStage',
      objectId: 'stage-3',
      payload: { from: 'IN_PROGRESS', to: 'BLOCKED', stageNumber: 3 },
    })
    expect(mocks.syncRecommendations).toHaveBeenCalledWith('coop-1')
    expect(dto).toMatchObject({ status: 'BLOCKED', blockingReason: 'Ждём ответ юридической службы вуза' })
  })

  it('завершение последнего открытого этапа пересчитывает этап 14: две записи истории и журнал пересчёта', async () => {
    seed(Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index + 1, 'COMPLETED'])))
    stageOf(13).status = 'IN_PROGRESS'
    stageOf(CONTROL_STAGE_NUMBER).status = 'IN_PROGRESS'

    const dto = await service.updateStage(MANAGER, 'stage-13', {
      status: 'COMPLETED',
      result: 'Итоги сотрудничества подведены',
    })

    expect(dto).toMatchObject({ status: 'COMPLETED', result: 'Итоги сотрудничества подведены' })
    expect(stageOf(13)).toMatchObject({ completedById: MANAGER.id })
    expect(stageOf(CONTROL_STAGE_NUMBER).status).toBe('COMPLETED')

    expect(mocks.stageHistory.create).toHaveBeenCalledTimes(2)
    expect(mocks.stageHistory.create.mock.calls[1]![0].data).toMatchObject({
      stageId: `stage-${CONTROL_STAGE_NUMBER}`,
      fromStatus: 'IN_PROGRESS',
      toStatus: 'COMPLETED',
      comment: 'Пересчитано автоматически по состоянию этапов 1–13',
    })
    const actions = mocks.writeAudit.mock.calls.map(([entry]) => entry.action)
    expect(actions).toEqual(['stage.auto.recompute', 'stage.status.change'])
  })

  it('повторная смена на тот же статус — 409 INVALID_TRANSITION (контракт), ничего не пишется', async () => {
    seed({ 3: 'IN_PROGRESS' })
    await expect(
      service.updateStage(MANAGER, 'stage-3', { status: 'IN_PROGRESS' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION', details: { from: 'IN_PROGRESS', to: 'IN_PROGRESS' } })
    expect(mocks.queryRaw).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it('двойной клик: этап уже сменили между чтением и записью — 409 CONFLICT, история не пишется', async () => {
    seed({ 3: 'IN_PROGRESS' })
    // Второй запрос прочитал IN_PROGRESS, а первый уже успел перевести этап дальше.
    mocks.workflowStage.updateMany.mockResolvedValueOnce({ count: 0 })

    await expectRejectCode(
      service.updateStage(MANAGER, 'stage-3', { status: 'BLOCKED', blockingReason: 'Причина' }),
      'CONFLICT',
    )
    expect(mocks.stageHistory.create).not.toHaveBeenCalled()
    expect(mocks.writeAudit).not.toHaveBeenCalled()
  })

  it('недопустимый переход по таблице — 409 INVALID_TRANSITION', async () => {
    seed({ 3: 'NOT_STARTED' })
    await expectRejectCode(
      service.updateStage(MANAGER, 'stage-3', { status: 'COMPLETED', result: 'Готово' }),
      'INVALID_TRANSITION',
    )
    expectNothingWritten()
  })

  it('этап закрытой связки не меняется — 409 CONFLICT', async () => {
    seed({ 3: 'IN_PROGRESS' })
    db.cooperation.status = 'COMPLETED'
    await expectRejectCode(
      service.updateStage(MANAGER, 'stage-3', { status: 'BLOCKED', blockingReason: 'Причина' }),
      'CONFLICT',
    )
    expectNothingWritten()
  })

  it('этап 7 не начать до подписания: отказ приходит до очереди и до записи', async () => {
    seed({ 6: 'IN_PROGRESS', 7: 'NOT_STARTED' })
    await expect(
      service.updateStage(MANAGER, 'stage-7', { status: 'IN_PROGRESS' }),
    ).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { blockingStages: [expect.objectContaining({ stageNumber: 6 })] },
    })
    expect(mocks.queryRaw).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it('правка полей без смены статуса — в журнале stage.fields.change, истории нет', async () => {
    seed({ 3: 'IN_PROGRESS' })
    await service.updateStage(MANAGER, 'stage-3', { deadline: '2026-10-15T00:00:00.000Z' })

    expect(mocks.stageHistory.create).not.toHaveBeenCalled()
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'stage.fields.change', payload: { stageNumber: 3, fields: ['deadline'] } }),
    )
  })
})
