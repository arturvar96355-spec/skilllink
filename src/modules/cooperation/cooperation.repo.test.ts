import { beforeEach, describe, expect, it, vi } from 'vitest'

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
