import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewStageData } from './cooperation.rules'

/**
 * `update` связки с подменённой базой (решение 187, находка ревью 27.09):
 * обновление условное — как у этапов (`workflow.repo.ts`) — статус связки
 * меняется, только если он всё ещё тот, что прочитал вызывающий сервис.
 * До исправления `update` писал безусловным `cooperation.update` без фильтра
 * по статусу и без признака, сколько строк изменилось: два одновременных
 * PATCH одной связки оба проходили проверку перехода по своему прочитанному
 * статусу и оба писали, не зная друг о друге — кто последний, тот и остался.
 */
const db = vi.hoisted(() => ({
  cooperation: { updateMany: vi.fn() },
}))

vi.mock('@/shared/db/prisma', () => ({ prisma: db }))

const repo = await import('./cooperation.repo')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('update: условное обновление по прочитанному статусу', () => {
  it('пишет через updateMany с фильтром по id и ожидаемому статусу', async () => {
    db.cooperation.updateMany.mockResolvedValue({ count: 1 })
    const count = await repo.update('coop-1', 'ACTIVE', { status: 'PAUSED' })
    expect(db.cooperation.updateMany).toHaveBeenCalledWith({
      where: { id: 'coop-1', status: 'ACTIVE' },
      data: { status: 'PAUSED' },
    })
    expect(count).toBe(1)
  })

  it('статус успели сменить с момента чтения — 0 изменённых строк, а не тихая перезапись', async () => {
    // Второй одновременный PATCH: та же связка, но статус на момент записи
    // уже не тот, что был прочитан этим запросом.
    db.cooperation.updateMany.mockResolvedValue({ count: 0 })
    const count = await repo.update('coop-1', 'ACTIVE', { goal: 'Новая цель' })
    expect(count).toBe(0)
  })
})

/**
 * `createWithStages` (решение 190, ревью базы): раньше 14 этапов заводились
 * циклом `tx.workflowStage.create`, у каждого — свой `tasks: { createMany }» для
 * чек-листа: до 14 последовательных запросов на этапы плюс по одному на задачи
 * каждого, всё под блокировкой программы (`lockProgram`) — чем дольше, тем дольше
 * ждёт вторая параллельная попытка завести связку по той же программе. Теперь
 * этапы и задачи каждый пишутся одним `createMany`. Здесь проверяется, что при
 * подмене tx это по-прежнему заводит все этапы с их номерами и чек-листами —
 * тем же результатом, что раньше давал цикл.
 */
describe('createWithStages: этапы и задачи одним createMany на каждую сущность', () => {
  const tx = {
    cooperation: { create: vi.fn() },
    workflowStage: { createMany: vi.fn() },
    task: { createMany: vi.fn() },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    tx.cooperation.create.mockResolvedValue({ id: 'coop-1' })
    tx.workflowStage.createMany.mockResolvedValue({ count: 0 })
    tx.task.createMany.mockResolvedValue({ count: 0 })
  })

  const stage = (stageNumber: number, tasks: NewStageData['tasks'] = []): NewStageData => ({
    stageNumber,
    title: `Этап ${stageNumber}`,
    phase: 'ATTRACTION',
    deadline: new Date('2026-10-01T00:00:00.000Z'),
    responsibleId: 'user-1',
    tasks,
  })

  it('создаёт связку через tx.cooperation.create и возвращает её id', async () => {
    const id = await repo.createWithStages(tx as never, { status: 'DRAFT' } as never, [])
    expect(tx.cooperation.create).toHaveBeenCalledWith({ data: { status: 'DRAFT' }, select: { id: true } })
    expect(id).toBe('coop-1')
  })

  it('заводит все этапы одним createMany, с номерами, датами и ответственным из шаблона', async () => {
    const stages = [stage(1), stage(2), stage(3)]
    await repo.createWithStages(tx as never, { status: 'DRAFT' } as never, stages)

    expect(tx.workflowStage.createMany).toHaveBeenCalledTimes(1)
    const data = tx.workflowStage.createMany.mock.calls[0]![0].data as Array<Record<string, unknown>>
    expect(data).toHaveLength(3)
    expect(data.map((row) => row.stageNumber)).toEqual([1, 2, 3])
    expect(data.every((row) => row.cooperationId === 'coop-1')).toBe(true)
    expect(data.every((row) => typeof row.id === 'string' && row.id.length > 0)).toBe(true)
    // Каждый этап — свой id, не один и тот же на всех.
    expect(new Set(data.map((row) => row.id)).size).toBe(3)
  })

  it('заводит чек-лист каждого этапа одним общим createMany, с привязкой к своему этапу', async () => {
    const stages = [
      stage(1, [{ title: 'Пункт 1.1', isRequired: true, isUniversityItem: false, sortOrder: 0 }]),
      stage(2, [
        { title: 'Пункт 2.1', isRequired: false, isUniversityItem: true, sortOrder: 0 },
        { title: 'Пункт 2.2', isRequired: true, isUniversityItem: false, sortOrder: 1 },
      ]),
    ]
    await repo.createWithStages(tx as never, { status: 'DRAFT' } as never, stages)

    const stageRows = tx.workflowStage.createMany.mock.calls[0]![0].data as Array<{ id: string; stageNumber: number }>
    const stage1Id = stageRows.find((row) => row.stageNumber === 1)!.id
    const stage2Id = stageRows.find((row) => row.stageNumber === 2)!.id

    expect(tx.task.createMany).toHaveBeenCalledTimes(1)
    const taskRows = tx.task.createMany.mock.calls[0]![0].data as Array<Record<string, unknown>>
    expect(taskRows).toHaveLength(3)
    expect(taskRows.filter((row) => row.stageId === stage1Id)).toHaveLength(1)
    expect(taskRows.filter((row) => row.stageId === stage2Id)).toHaveLength(2)
    expect(taskRows.find((row) => row.title === 'Пункт 1.1')).toMatchObject({
      isRequired: true,
      isUniversityItem: false,
      sortOrder: 0,
      stageId: stage1Id,
    })
  })

  it('без единой задачи в чек-листах — task.createMany не вызывается', async () => {
    await repo.createWithStages(tx as never, { status: 'DRAFT' } as never, [stage(1), stage(2)])
    expect(tx.task.createMany).not.toHaveBeenCalled()
  })
})
