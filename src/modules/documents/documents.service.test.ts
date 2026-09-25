import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type {
  CooperationStatus,
  DocumentStatus,
  DocumentType,
  StageStatus,
  UserRole,
} from '@/shared/contracts/enums'
import { SIGNING_STAGE_NUMBER, WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import { expectRejectCode } from '@/shared/testing/expect-code'

/**
 * Сервис документов (аудит K-41): смена статуса по таблице переходов и отметка
 * пунктов этапа 6 «Подписание документов» при подписи договора (решение 87).
 *
 * База подменена моделью в памяти: документы связки, этапы 1–6 и пункты этапа 6.
 * Сервис документов, workflow.markTasksBySignedDocuments/setTaskDone и оба репозитория
 * работают по-настоящему. Журнал и сверка рекомендаций подменены.
 */
interface FakeDocument {
  id: string
  type: DocumentType
  title: string
  status: DocumentStatus
  content: string | null
  fileReference: string | null
  cooperationId: string | null
  signedAt: Date | null
  createdAt: Date
}

interface FakeStage {
  id: string
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
}

const SIGNING_TITLES =
  WORKFLOW_STAGES.find((stage) => stage.number === SIGNING_STAGE_NUMBER)!.tasks
    .filter((task) => task.closedBySignedDocuments)
    .map((task) => task.title)

const db = {
  cooperation: { id: 'coop-1', status: 'ACTIVE' as CooperationStatus },
  documents: [] as FakeDocument[],
  stages: [] as FakeStage[],
  tasks: [] as FakeTask[],
  /** Статус этапа 6, который увидит запись под блокировкой связки: «успели закрыть». */
  signingStatusUnderLock: null as StageStatus | null,
}

const mocks = vi.hoisted(() => ({
  document: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  documentHistory: { create: vi.fn() },
  cooperation: { findUnique: vi.fn() },
  workflowStage: { findUnique: vi.fn(), findMany: vi.fn() },
  task: { findUnique: vi.fn(), update: vi.fn() },
  queryRaw: vi.fn(),
  writeAudit: vi.fn(),
  syncRecommendations: vi.fn(),
}))

vi.mock('@/shared/db/prisma', () => {
  const client = {
    document: mocks.document,
    documentHistory: mocks.documentHistory,
    cooperation: mocks.cooperation,
    workflowStage: mocks.workflowStage,
    task: mocks.task,
    $queryRaw: mocks.queryRaw,
  }
  return { prisma: { ...client, $transaction: (fn: (tx: typeof client) => unknown) => fn(client) } }
})
vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))
vi.mock('@/modules/recommendations/recommendations.service', () => ({
  syncCooperation: mocks.syncRecommendations,
}))

const service = await import('./documents.service')

const as = (role: UserRole): CurrentUser => ({
  id: `${role.toLowerCase()}-1`,
  email: `${role.toLowerCase()}@example.invalid`,
  fullName: 'Тестовый Пользователь',
  role,
  universityId: role === 'UNIVERSITY_REP' ? 'uni-1' : null,
})

const MANAGER = as('MANAGER')

const docOf = (id: string) => db.documents.find((row) => row.id === id)!
const stageOf = (stageNumber: number) => db.stages.find((row) => row.stageNumber === stageNumber)!
const taskOf = (id: string) => db.tasks.find((row) => row.id === id)!

function addDocument(
  id: string,
  type: DocumentType,
  status: DocumentStatus,
  extra: Partial<FakeDocument> = {},
): FakeDocument {
  const document: FakeDocument = {
    id,
    type,
    title: `Документ ${id}`,
    status,
    content: null,
    fileReference: 'https://example.invalid/doc.pdf',
    cooperationId: 'coop-1',
    signedAt: null,
    createdAt: new Date('2026-09-10T00:00:00Z'),
    ...extra,
  }
  db.documents.push(document)
  return document
}

/** Строка документа в форме `detailSelect` репозитория. */
function detailRow(document: FakeDocument) {
  return {
    id: document.id,
    type: document.type,
    title: document.title,
    version: '1',
    status: document.status,
    content: document.content,
    templateKey: null,
    fileReference: document.fileReference,
    issuedAt: null,
    signedAt: document.signedAt,
    cooperationId: document.cooperationId,
    universityId: 'uni-1',
    programId: null,
    createdAt: document.createdAt,
    updatedAt: document.createdAt,
    author: null,
    responsible: null,
    university: { id: 'uni-1', name: 'Тестовый университет связи', shortName: 'ТУС' },
    program: null,
    history: [],
  }
}

/** Строка этапа в форме `stageSelect` репозитория этапов. */
function stageRow(stage: FakeStage) {
  return {
    id: stage.id,
    cooperationId: db.cooperation.id,
    stageNumber: stage.stageNumber,
    title: stage.title,
    phase: 'FORMALIZATION',
    status: stage.status,
    deadline: null,
    comment: null,
    result: null,
    blockingReason: null,
    startedAt: null,
    completedAt: null,
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
        isUniversityItem: false,
        confirmationNote: null,
        doneBy: null,
      })),
    cooperation: { university: { users: [] } },
  }
}

/** Связка: этапы 1–5 завершены, этап 6 в работе; договор утверждён и ждёт подписи. */
function seed(): void {
  db.cooperation = { id: 'coop-1', status: 'ACTIVE' }
  db.documents = []
  db.signingStatusUnderLock = null
  addDocument('agreement', 'AGREEMENT', 'APPROVED')
  db.stages = WORKFLOW_STAGES.filter((stage) => stage.number <= SIGNING_STAGE_NUMBER).map((stage) => ({
    id: `stage-${stage.number}`,
    stageNumber: stage.number,
    title: stage.title,
    status: stage.number < SIGNING_STAGE_NUMBER ? 'COMPLETED' : 'IN_PROGRESS',
  }))
  db.tasks = [
    ...SIGNING_TITLES.map((title, index) => ({
      id: `sign-${index + 1}`,
      stageId: 'stage-6',
      title,
      isRequired: true,
      isDone: false,
      doneAt: null,
      doneById: null,
    })),
    // Пункт, добавленный руками: подпись документов его не закрывает.
    {
      id: 'sign-manual',
      stageId: 'stage-6',
      title: 'Экземпляр передан в архив вуза',
      isRequired: false,
      isDone: false,
      doneAt: null,
      doneById: null,
    },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  seed()

  mocks.document.findFirst.mockImplementation(async ({ where }) => {
    const document = db.documents.find((row) => row.id === where.id)
    return document ? detailRow(document) : null
  })
  mocks.document.findUnique.mockImplementation(async ({ where }) => {
    const document = db.documents.find((row) => row.id === where.id)
    return document ? detailRow(document) : null
  })
  mocks.document.updateMany.mockImplementation(async ({ where, data }) => {
    const document = db.documents.find((row) => row.id === where.id && row.status === where.status)
    if (!document) return { count: 0 }
    Object.assign(document, data)
    return { count: 1 }
  })
  // Как в базе: действующие документы связки — без архивных, свежие первыми.
  mocks.document.findMany.mockImplementation(async ({ where }) =>
    db.documents
      .filter((row) => row.cooperationId === where.cooperationId)
      .filter((row) => (where.status?.not ? row.status !== where.status.not : true))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((row) => ({ title: row.title, type: row.type, status: row.status, templateKey: null })),
  )
  mocks.documentHistory.create.mockResolvedValue({})
  mocks.cooperation.findUnique.mockImplementation(async () => ({ status: db.cooperation.status }))
  mocks.workflowStage.findUnique.mockImplementation(async ({ where }) => {
    if (where.id) {
      const stage = db.stages.find((row) => row.id === where.id)
      if (!stage) return null
      const status =
        stage.stageNumber === SIGNING_STAGE_NUMBER && db.signingStatusUnderLock
          ? db.signingStatusUnderLock
          : stage.status
      return { status, stageNumber: stage.stageNumber }
    }
    const stage = db.stages.find((row) => row.stageNumber === where.cooperationId_stageNumber.stageNumber)
    return stage ? stageRow(stage) : null
  })
  mocks.workflowStage.findMany.mockImplementation(async ({ where }) =>
    db.stages
      .filter((row) => row.stageNumber < where.stageNumber.lt)
      .map((row) => ({ stageNumber: row.stageNumber, title: row.title, status: row.status })),
  )
  mocks.task.findUnique.mockImplementation(async ({ where }) => {
    const task = db.tasks.find((row) => row.id === where.id)
    return task ? { isDone: task.isDone } : null
  })
  mocks.task.update.mockImplementation(async ({ where, data }) => {
    Object.assign(taskOf(where.id), data)
    return {}
  })
  mocks.queryRaw.mockResolvedValue([])
})

const sign = (id = 'agreement', user: CurrentUser = MANAGER) =>
  service.changeStatus(user, id, { status: 'SIGNED' })

const auditActions = () => mocks.writeAudit.mock.calls.map(([entry]) => entry.action)

describe('changeStatus: таблица переходов', () => {
  it.each([
    ['DRAFT', 'SIGNED'],
    ['DRAFT', 'APPROVED'],
    ['REVIEW', 'SIGNED'],
    ['SIGNED', 'DRAFT'],
    ['SIGNED', 'APPROVED'],
    ['REJECTED', 'SIGNED'],
    ['ARCHIVED', 'DRAFT'],
    ['ARCHIVED', 'SIGNED'],
  ] as Array<[DocumentStatus, DocumentStatus]>)('%s → %s запрещён — 409 INVALID_TRANSITION', async (from, to) => {
    addDocument('doc', 'NDA', from)
    await expect(service.changeStatus(MANAGER, 'doc', { status: to })).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { from, to },
    })
    expect(docOf('doc').status).toBe(from)
    expect(mocks.document.updateMany).not.toHaveBeenCalled()
    expect(mocks.documentHistory.create).not.toHaveBeenCalled()
    expect(mocks.writeAudit).not.toHaveBeenCalled()
  })

  it('тот же статус — 409 INVALID_TRANSITION', async () => {
    await expectRejectCode(service.changeStatus(MANAGER, 'agreement', { status: 'APPROVED' }), 'INVALID_TRANSITION')
    expect(mocks.document.updateMany).not.toHaveBeenCalled()
  })

  it('отклонение без основания — 422', async () => {
    addDocument('doc', 'NDA', 'REVIEW')
    await expectRejectCode(service.changeStatus(MANAGER, 'doc', { status: 'REJECTED' }), 'VALIDATION_ERROR')
    expect(mocks.document.updateMany).not.toHaveBeenCalled()
  })

  it('пустой документ на согласование не отправляется — 422', async () => {
    addDocument('doc', 'NDA', 'DRAFT', { fileReference: null, content: null })
    await expectRejectCode(service.changeStatus(MANAGER, 'doc', { status: 'REVIEW' }), 'VALIDATION_ERROR')
    expect(mocks.document.updateMany).not.toHaveBeenCalled()
  })

  it('разрешённый переход: статус, дата подписи, история и журнал; не договор — этап 6 не трогается', async () => {
    addDocument('nda', 'NDA', 'APPROVED')

    const dto = await service.changeStatus(MANAGER, 'nda', { status: 'SIGNED', comment: 'Подписано' })

    expect(mocks.document.updateMany.mock.calls[0]![0]).toEqual({
      where: { id: 'nda', status: 'APPROVED' },
      data: { status: 'SIGNED', signedAt: expect.any(Date) },
    })
    expect(mocks.documentHistory.create).toHaveBeenCalledWith({
      data: { documentId: 'nda', fromStatus: 'APPROVED', toStatus: 'SIGNED', comment: 'Подписано', changedById: MANAGER.id },
    })
    expect(mocks.writeAudit).toHaveBeenCalledWith({
      userId: MANAGER.id,
      action: 'document.status.change',
      objectType: 'Document',
      objectId: 'nda',
      payload: { from: 'APPROVED', to: 'SIGNED' },
    })
    expect(dto.status).toBe('SIGNED')
    expect(dto.signedAt).not.toBeNull()
    expect('stageChecklist' in dto).toBe(false)
    expect(mocks.cooperation.findUnique).not.toHaveBeenCalled()
  })

  it('двойной клик: статус уже сменили — 409 CONFLICT, история и журнал не пишутся', async () => {
    mocks.document.updateMany.mockResolvedValueOnce({ count: 0 })
    await expectRejectCode(sign(), 'CONFLICT')
    expect(mocks.documentHistory.create).not.toHaveBeenCalled()
    expect(mocks.writeAudit).not.toHaveBeenCalled()
    expect(mocks.task.update).not.toHaveBeenCalled()
  })

  it('несуществующий документ — 404; представитель вуза статус не меняет — 403 до базы', async () => {
    await expectRejectCode(sign('missing'), 'NOT_FOUND')
    await expectRejectCode(sign('agreement', as('UNIVERSITY_REP')), 'FORBIDDEN')
    expect(mocks.document.findFirst).toHaveBeenCalledTimes(1)
    expect(mocks.document.updateMany).not.toHaveBeenCalled()
  })
})

describe('подпись договора отмечает пункты этапа 6 (решение 87)', () => {
  it('marked: договор подписан — отмечены три пункта подписания, ручной пункт не тронут', async () => {
    const dto = await sign()

    expect(dto.status).toBe('SIGNED')
    expect(dto.stageChecklist).toEqual({ stageNumber: 6, marked: 3, outcome: 'marked' })
    for (const id of ['sign-1', 'sign-2', 'sign-3']) {
      expect(taskOf(id)).toMatchObject({ isDone: true, doneById: MANAGER.id })
    }
    expect(taskOf('sign-manual').isDone).toBe(false)

    // Каждая отметка — в журнале с источником «документ подписан».
    expect(auditActions()).toEqual(['document.status.change', 'task.toggle', 'task.toggle', 'task.toggle'])
    expect(mocks.writeAudit.mock.calls[1]![0]).toMatchObject({
      objectType: 'Task',
      objectId: 'sign-1',
      payload: { isDone: true, stageId: 'stage-6', source: 'document.signed', documentId: 'agreement' },
    })
    expect(mocks.syncRecommendations).toHaveBeenCalledTimes(1)
  })

  it('marked: уже отмеченный руками пункт не переписывается, счёт — только новые', async () => {
    Object.assign(taskOf('sign-2'), { isDone: true, doneById: 'admin-1' })

    const dto = await sign()

    expect(dto.stageChecklist).toEqual({ stageNumber: 6, marked: 2, outcome: 'marked' })
    expect(taskOf('sign-2').doneById).toBe('admin-1')
  })

  it('nothing-to-mark: все пункты подписания уже отмечены', async () => {
    for (const id of ['sign-1', 'sign-2', 'sign-3']) taskOf(id).isDone = true

    const dto = await sign()

    expect(dto.stageChecklist).toEqual({ stageNumber: 6, marked: 0, outcome: 'nothing-to-mark' })
    expect(mocks.task.update).not.toHaveBeenCalled()
    expect(mocks.syncRecommendations).not.toHaveBeenCalled()
  })

  it('pending-documents: другой договор связки ещё на согласовании', async () => {
    addDocument('agreement-annex', 'AGREEMENT', 'REVIEW')

    const dto = await sign()

    expect(dto.status).toBe('SIGNED')
    expect(dto.stageChecklist).toEqual({ stageNumber: 6, marked: 0, outcome: 'pending-documents' })
    // До этапов дело не дошло.
    expect(mocks.cooperation.findUnique).not.toHaveBeenCalled()
    expect(mocks.task.update).not.toHaveBeenCalled()
  })

  it('архивный и отклонённый договоры подписание не блокируют', async () => {
    addDocument('agreement-old', 'AGREEMENT', 'ARCHIVED')
    addDocument('agreement-rejected', 'AGREEMENT', 'REJECTED')

    const dto = await sign()

    expect(mocks.document.findMany.mock.calls[0]![0].where).toEqual({
      cooperationId: 'coop-1',
      status: { not: 'ARCHIVED' },
    })
    expect(dto.stageChecklist).toEqual({ stageNumber: 6, marked: 3, outcome: 'marked' })
  })

  it('подпись лицензии при подписанном договоре тоже отмечает пункты', async () => {
    docOf('agreement').status = 'SIGNED'
    addDocument('license', 'LICENSE', 'APPROVED')

    const dto = await sign('license')

    expect(dto.stageChecklist).toEqual({ stageNumber: 6, marked: 3, outcome: 'marked' })
  })

  it('подпись лицензии при неподписанном договоре — pending-documents', async () => {
    addDocument('license', 'LICENSE', 'APPROVED')
    const dto = await sign('license')
    expect(dto.stageChecklist).toEqual({ stageNumber: 6, marked: 0, outcome: 'pending-documents' })
  })

  it('locked: этап 6 — контрольная точка, а этап 5 ещё открыт', async () => {
    stageOf(5).status = 'IN_PROGRESS'

    const dto = await sign()

    expect(dto.stageChecklist).toEqual({ stageNumber: 6, marked: 0, outcome: 'locked' })
    expect(mocks.task.update).not.toHaveBeenCalled()
    expect(mocks.queryRaw).not.toHaveBeenCalled()
  })

  it('locked: этап 6 успели закрыть — отказ под блокировкой связки, пункты не отмечены', async () => {
    db.signingStatusUnderLock = 'COMPLETED'

    const dto = await sign()

    expect(dto.stageChecklist).toEqual({ stageNumber: 6, marked: 0, outcome: 'locked' })
    // Первый же отказ останавливает отметку: остальные пункты не трогаются.
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1)
    expect(mocks.task.update).not.toHaveBeenCalled()
    expect(auditActions()).toEqual(['document.status.change'])
  })

  it.each(['COMPLETED', 'CANCELLED'] as const)('stage-closed: этап 6 %s', async (status) => {
    stageOf(6).status = status
    const dto = await sign()
    expect(dto.stageChecklist).toEqual({ stageNumber: 6, marked: 0, outcome: 'stage-closed' })
    expect(mocks.task.update).not.toHaveBeenCalled()
  })

  it.each(['COMPLETED', 'CANCELLED'] as const)(
    'cooperation-closed: связка %s — документ подписывается, этапы не трогаются',
    async (status) => {
      db.cooperation.status = status
      const dto = await sign()
      expect(dto.status).toBe('SIGNED')
      expect(dto.stageChecklist).toEqual({ stageNumber: 6, marked: 0, outcome: 'cooperation-closed' })
      expect(mocks.workflowStage.findUnique).not.toHaveBeenCalled()
      expect(mocks.task.update).not.toHaveBeenCalled()
    },
  )

  it('договор без связки — stageChecklist нет', async () => {
    addDocument('free-agreement', 'AGREEMENT', 'APPROVED', { cooperationId: null })
    const dto = await sign('free-agreement')
    expect(dto.status).toBe('SIGNED')
    expect('stageChecklist' in dto).toBe(false)
    expect(mocks.document.findMany).not.toHaveBeenCalled()
  })

  it('сбой отметки не отменяет подпись: stageChecklist нет, ошибка только в лог', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.document.findMany.mockRejectedValueOnce(new Error('connection reset'))

    try {
      const dto = await sign()

      expect(dto.status).toBe('SIGNED')
      expect(docOf('agreement').status).toBe('SIGNED')
      expect('stageChecklist' in dto).toBe(false)
      expect(log).toHaveBeenCalledTimes(1)
    } finally {
      log.mockRestore()
    }
  })
})
