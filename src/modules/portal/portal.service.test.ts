import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { CooperationStatus, StageStatus, UserRole } from '@/shared/contracts/enums'
import { WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import { expectRejectCode } from '@/shared/testing/expect-code'

/**
 * Кабинет вуза (аудит K-41): подтверждение материалов и показатели программ.
 *
 * База подменена моделью в памяти: два вуза, у каждого связка с этапами 1–7 и пункты
 * этапа передачи материалов. Сервис кабинета, запись пункта (workflow.setTaskDone)
 * и репозитории работают по-настоящему — проверяется, что чужое не видно,
 * что отказы не доходят до записи и что в журнал не уходит свободный текст.
 */
interface FakeStage {
  id: string
  cooperationId: string
  stageNumber: number
  title: string
  status: StageStatus
}

interface FakeTask {
  id: string
  stageId: string
  title: string
  isRequired: boolean
  isDone: boolean
  doneAt: Date | null
  doneById: string | null
  confirmationNote: string | null
}

interface FakeProgram {
  id: string
  universityId: string
  name: string
  level: string
  applicationCount: number | null
  studentCount: number | null
  groupCount: number | null
  metricsUpdatedAt: Date | null
  archivedAt: Date | null
}

const db = {
  universities: [
    { id: 'uni-1', name: 'Тестовый университет связи', archivedAt: null },
    { id: 'uni-2', name: 'Другой тестовый университет', archivedAt: null },
  ],
  cooperations: [] as Array<{ id: string; universityId: string; status: CooperationStatus }>,
  stages: [] as FakeStage[],
  tasks: [] as FakeTask[],
  programs: [] as FakeProgram[],
}

const mocks = vi.hoisted(() => ({
  university: { findUnique: vi.fn() },
  task: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  workflowStage: { findUnique: vi.fn(), findMany: vi.fn() },
  educationalProgram: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  queryRaw: vi.fn(),
  writeAudit: vi.fn(),
  syncRecommendations: vi.fn(),
}))

vi.mock('@/shared/db/prisma', () => {
  const client = {
    university: mocks.university,
    task: mocks.task,
    workflowStage: mocks.workflowStage,
    educationalProgram: mocks.educationalProgram,
    $queryRaw: mocks.queryRaw,
  }
  return { prisma: { ...client, $transaction: (fn: (tx: typeof client) => unknown) => fn(client) } }
})
vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))
vi.mock('@/modules/recommendations/recommendations.service', () => ({
  syncCooperation: mocks.syncRecommendations,
}))

const service = await import('./portal.service')

const as = (role: UserRole, universityId: string | null = null): CurrentUser => ({
  id: `${role.toLowerCase()}-1`,
  email: `${role.toLowerCase()}@example.invalid`,
  fullName: 'Тестовый Пользователь',
  role,
  universityId: role === 'UNIVERSITY_REP' ? (universityId ?? 'uni-1') : null,
})

const REP = as('UNIVERSITY_REP', 'uni-1')

const cooperationOf = (id: string) => db.cooperations.find((row) => row.id === id)!
const stageOf = (cooperationId: string, stageNumber: number) =>
  db.stages.find((row) => row.cooperationId === cooperationId && row.stageNumber === stageNumber)!
const taskOf = (id: string) => db.tasks.find((row) => row.id === id)!

/** Связка с этапами 1–7: по умолчанию договор подписан (1–6 завершены), этап 7 в работе. */
function addCooperation(id: string, universityId: string, stage7: StageStatus = 'IN_PROGRESS', stage6: StageStatus = 'COMPLETED') {
  db.cooperations.push({ id, universityId, status: 'ACTIVE' })
  for (const definition of WORKFLOW_STAGES.filter((row) => row.number <= 7)) {
    db.stages.push({
      id: `${id}-stage-${definition.number}`,
      cooperationId: id,
      stageNumber: definition.number,
      title: definition.title,
      status: definition.number === 7 ? stage7 : definition.number === 6 ? stage6 : 'COMPLETED',
    })
  }
}

function addTask(id: string, stageId: string, title: string, extra: Partial<FakeTask> = {}) {
  db.tasks.push({
    id,
    stageId,
    title,
    isRequired: true,
    isDone: false,
    doneAt: null,
    doneById: null,
    confirmationNote: null,
    ...extra,
  })
}

function seed(): void {
  db.cooperations = []
  db.stages = []
  db.tasks = []
  addCooperation('coop-1', 'uni-1')
  addCooperation('coop-2', 'uni-2')
  addTask('mat-1', 'coop-1-stage-7', 'Переданы учебные материалы')
  addTask('mat-uni', 'coop-1-stage-7', 'Вуз подтвердил получение материалов')
  addTask('sign-1', 'coop-1-stage-6', 'Документы подписаны со стороны вуза', { isDone: true })
  addTask('foreign-mat', 'coop-2-stage-7', 'Переданы учебные материалы')

  const program = (id: string, universityId: string, extra: Partial<FakeProgram> = {}): FakeProgram => ({
    id,
    universityId,
    name: `Программа ${id}`,
    level: 'BACHELOR',
    applicationCount: 10,
    studentCount: 50,
    groupCount: 2,
    metricsUpdatedAt: null,
    archivedAt: null,
    ...extra,
  })
  db.programs = [
    program('prog-1', 'uni-1'),
    program('prog-2', 'uni-2'),
    program('prog-archived', 'uni-1', { archivedAt: new Date('2026-09-01T00:00:00Z') }),
  ]
}

function materialRow(task: FakeTask) {
  const stage = db.stages.find((row) => row.id === task.stageId)!
  const cooperation = cooperationOf(stage.cooperationId)
  return {
    id: task.id,
    title: task.title,
    isDone: task.isDone,
    doneAt: task.doneAt,
    isRequired: task.isRequired,
    stage: {
      id: stage.id,
      status: stage.status,
      stageNumber: stage.stageNumber,
      cooperationId: stage.cooperationId,
      cooperation: {
        universityId: cooperation.universityId,
        status: cooperation.status,
        program: { name: 'Программа' },
        product: { name: 'Продукт' },
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  seed()

  mocks.university.findUnique.mockImplementation(
    async ({ where }) => db.universities.find((row) => row.id === where.id) ?? null,
  )
  // Как в базе: пункт ищется только среди связок вуза из запроса.
  mocks.task.findFirst.mockImplementation(async ({ where }) => {
    const task = db.tasks.find((row) => row.id === where.id)
    if (!task) return null
    const row = materialRow(task)
    return row.stage.cooperation.universityId === where.stage.cooperation.universityId ? row : null
  })
  mocks.task.findUnique.mockImplementation(async ({ where }) => {
    const task = db.tasks.find((row) => row.id === where.id)
    return task ? { isDone: task.isDone } : null
  })
  mocks.task.findMany.mockImplementation(async ({ where }) =>
    db.tasks
      .map(materialRow)
      .filter(
        (row) =>
          row.stage.stageNumber === where.stage.stageNumber &&
          row.stage.cooperation.universityId === where.stage.cooperation.universityId,
      ),
  )
  mocks.task.update.mockImplementation(async ({ where, data }) => {
    Object.assign(taskOf(where.id), data)
    return {}
  })
  mocks.workflowStage.findUnique.mockImplementation(async ({ where }) => {
    const stage = db.stages.find((row) => row.id === where.id)
    return stage ? { status: stage.status, stageNumber: stage.stageNumber } : null
  })
  mocks.workflowStage.findMany.mockImplementation(async ({ where }) =>
    db.stages
      .filter((row) => row.cooperationId === where.cooperationId && row.stageNumber < where.stageNumber.lt)
      .map((row) => ({ stageNumber: row.stageNumber, title: row.title, status: row.status })),
  )
  mocks.educationalProgram.findFirst.mockImplementation(async ({ where }) => {
    const program = db.programs.find(
      (row) =>
        row.id === where.id &&
        row.universityId === where.universityId &&
        (where.archivedAt === null ? row.archivedAt === null : true),
    )
    return program ? { id: program.id, universityId: program.universityId, metricsSource: 'MANUAL' } : null
  })
  mocks.educationalProgram.findMany.mockImplementation(async ({ where }) =>
    db.programs.filter((row) => row.universityId === where.universityId && row.archivedAt === null),
  )
  mocks.educationalProgram.update.mockImplementation(async ({ where, data }) => {
    Object.assign(db.programs.find((row) => row.id === where.id)!, data)
    return {}
  })
  mocks.queryRaw.mockResolvedValue([])
})

function expectNothingWritten(): void {
  expect(mocks.task.update).not.toHaveBeenCalled()
  expect(mocks.educationalProgram.update).not.toHaveBeenCalled()
  expect(mocks.writeAudit).not.toHaveBeenCalled()
}

describe('confirmMaterial: подтверждение материалов вузом', () => {
  it('пункт связки чужого вуза — 404, как будто его нет; universityId из запроса игнорируется', async () => {
    await expect(
      service.confirmMaterial(REP, 'foreign-mat', 'uni-2', {}),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Задача не найдена' })

    // Поиск шёл только среди связок своего вуза.
    expect(mocks.task.findFirst.mock.calls[0]![0].where).toMatchObject({
      id: 'foreign-mat',
      stage: { cooperation: { universityId: 'uni-1' } },
    })
    expect(taskOf('foreign-mat').isDone).toBe(false)
    expect(mocks.queryRaw).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it('пункт не из этапа 7 — 404 «не относится к передаче материалов»', async () => {
    Object.assign(taskOf('sign-1'), { isDone: false })
    await expect(service.confirmMaterial(REP, 'sign-1', undefined, {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Задача не относится к передаче материалов',
    })
    expect(taskOf('sign-1').isDone).toBe(false)
    expectNothingWritten()
  })

  it.each(['COMPLETED', 'CANCELLED'] as const)('связка %s — 409 CONFLICT, пункт не меняется', async (status) => {
    cooperationOf('coop-1').status = status
    await expectRejectCode(service.confirmMaterial(REP, 'mat-1', undefined, {}), 'CONFLICT')
    expect(taskOf('mat-1').isDone).toBe(false)
    expect(mocks.queryRaw).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it('подтверждение: автор — представитель, в журнале только признак комментария', async () => {
    const comment = 'Получили, звонил Тестов Т. Т., тел. +7 900 000-00-00'

    const list = await service.confirmMaterial(REP, 'mat-1', undefined, { comment })

    expect(taskOf('mat-1')).toMatchObject({ isDone: true, doneById: REP.id, confirmationNote: null })
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1)
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1)
    expect(mocks.writeAudit).toHaveBeenCalledWith({
      userId: REP.id,
      action: 'portal.material.confirm',
      objectType: 'Task',
      objectId: 'mat-1',
      payload: { universityId: 'uni-1', withComment: true },
    })
    const logged = JSON.stringify(mocks.writeAudit.mock.calls)
    expect(logged).not.toContain('Тестов')
    expect(logged).not.toContain('+7 900')

    // В ответе — список материалов своего вуза, пункт уже подтверждён.
    expect(list.map((row) => row.taskId)).toEqual(['mat-1', 'mat-uni'])
    expect(list.find((row) => row.taskId === 'mat-1')).toMatchObject({
      isConfirmed: true,
      canConfirm: false,
      lockedReason: null,
    })
  })

  it('без комментария — withComment: false', async () => {
    await service.confirmMaterial(REP, 'mat-1', undefined, {})
    expect(mocks.writeAudit.mock.calls[0]![0].payload).toEqual({ universityId: 'uni-1', withComment: false })
  })

  it('повторное подтверждение — без ошибки и без записи, даже когда этап 7 уже завершён', async () => {
    Object.assign(taskOf('mat-1'), { isDone: true, doneById: 'university_rep-0' })
    stageOf('coop-1', 7).status = 'COMPLETED'

    const list = await service.confirmMaterial(REP, 'mat-1', undefined, { comment: 'ещё раз' })

    expect(taskOf('mat-1').doneById).toBe('university_rep-0')
    expectNothingWritten()
    expect(list.find((row) => row.taskId === 'mat-1')).toMatchObject({ isConfirmed: true })
  })

  it('неподтверждённый пункт завершённого этапа 7 — 409 CONFLICT', async () => {
    stageOf('coop-1', 7).status = 'COMPLETED'
    await expectRejectCode(service.confirmMaterial(REP, 'mat-1', undefined, {}), 'CONFLICT')
    expectNothingWritten()
  })

  it('договор не подписан (этап 6 не завершён) — 409 INVALID_TRANSITION, в списке — причина', async () => {
    stageOf('coop-1', 6).status = 'IN_PROGRESS'
    stageOf('coop-1', 7).status = 'NOT_STARTED'

    await expect(service.confirmMaterial(REP, 'mat-1', undefined, {})).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { stageNumber: 7, blockingStages: [expect.objectContaining({ stageNumber: 6 })] },
    })
    expect(taskOf('mat-1').isDone).toBe(false)
    expectNothingWritten()

    const list = await service.materials(REP, undefined)
    expect(list.find((row) => row.taskId === 'mat-1')).toMatchObject({
      canConfirm: false,
      lockedReason: 'Не закрыт этап 6 «Подписание документов»',
    })
  })

  it.each(['ADMIN', 'MANAGER'] as const)('%s в кабинете вуза только смотрит — 403 до базы', async (role) => {
    await expectRejectCode(service.confirmMaterial(as(role), 'mat-1', 'uni-1', {}), 'FORBIDDEN')
    expect(mocks.task.findFirst).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it.each(['ANALYST', 'VIEWER'] as const)('%s кабинет вуза не открывает — 403', async (role) => {
    await expectRejectCode(service.confirmMaterial(as(role), 'mat-1', 'uni-1', {}), 'FORBIDDEN')
    expectNothingWritten()
  })
})

describe('updateProgramMetrics: показатели — только своего вуза', () => {
  it('своя программа: пишутся только присланные поля, источник — вуз, в журнале — имена полей', async () => {
    const dto = await service.updateProgramMetrics(REP, 'prog-1', undefined, { studentCount: 137 })

    expect(mocks.educationalProgram.update).toHaveBeenCalledTimes(1)
    const { where, data } = mocks.educationalProgram.update.mock.calls[0]![0]
    expect(where).toEqual({ id: 'prog-1' })
    expect(data).toEqual({ studentCount: 137, metricsSource: 'MANUAL', metricsUpdatedAt: expect.any(Date) })
    expect(mocks.writeAudit).toHaveBeenCalledWith({
      userId: REP.id,
      action: 'portal.metrics.update',
      objectType: 'EducationalProgram',
      objectId: 'prog-1',
      payload: { fields: ['studentCount'] },
    })
    expect(dto).toMatchObject({ id: 'prog-1', studentCount: 137, groupCount: 2 })
    expect(dto.metricsUpdatedAt).not.toBeNull()
  })

  it('null — «Нет данных» — записывается как null, а не 0', async () => {
    const dto = await service.updateProgramMetrics(REP, 'prog-1', undefined, { groupCount: null })
    expect(mocks.educationalProgram.update.mock.calls[0]![0].data).toMatchObject({ groupCount: null })
    expect(dto.groupCount).toBeNull()
  })

  it('программа чужого вуза — 404, даже если передан её universityId', async () => {
    await expect(
      service.updateProgramMetrics(REP, 'prog-2', 'uni-2', { studentCount: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Образовательная программа не найдена' })
    expect(mocks.educationalProgram.findFirst.mock.calls[0]![0].where).toMatchObject({
      id: 'prog-2',
      universityId: 'uni-1',
    })
    expect(db.programs.find((row) => row.id === 'prog-2')!.studentCount).toBe(50)
    expectNothingWritten()
  })

  it('архивная программа своего вуза — 404', async () => {
    await expectRejectCode(
      service.updateProgramMetrics(REP, 'prog-archived', undefined, { studentCount: 1 }),
      'NOT_FOUND',
    )
    expectNothingWritten()
  })

  it.each(['ADMIN', 'MANAGER'] as const)('%s показатели за вуз не вносит — 403 до базы', async (role) => {
    await expectRejectCode(
      service.updateProgramMetrics(as(role), 'prog-1', 'uni-1', { studentCount: 1 }),
      'FORBIDDEN',
    )
    expect(mocks.educationalProgram.findFirst).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it('представитель без назначенного вуза — 403', async () => {
    const orphan: CurrentUser = { ...REP, universityId: null }
    await expectRejectCode(
      service.updateProgramMetrics(orphan, 'prog-1', 'uni-1', { studentCount: 1 }),
      'FORBIDDEN',
    )
    expectNothingWritten()
  })
})
