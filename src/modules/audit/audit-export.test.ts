import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import { auditExportQuerySchema } from './audit.schema'

/** Выгрузка журнала для внешней системы (решение 133): NDJSON, курсор, запись о выгрузке. */
const mocks = vi.hoisted(() => ({ findAuditPageAfter: vi.fn(), writeAudit: vi.fn() }))
vi.mock('./audit.repo', () => ({ findAuditPageAfter: mocks.findAuditPageAfter }))
vi.mock('@/shared/audit/audit', () => ({ writeAudit: mocks.writeAudit }))

const { exportAuditEntries } = await import('./audit.service')

const admin: CurrentUser = { id: 'adm', email: 'a@x.test', fullName: 'А', role: 'ADMIN', universityId: null }
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  userId: 'u1',
  action: 'user.block',
  objectType: 'User',
  objectId: 'u2',
  payload: { source: 'x' },
  createdAt: new Date('2026-09-26T10:00:00Z'),
  ...extra,
})

beforeEach(() => {
  mocks.findAuditPageAfter.mockReset()
  mocks.writeAudit.mockReset()
})

describe('выгрузка журнала NDJSON', () => {
  it('строка на запись со всеми колонками (и будущими: BigInt строкой), курсор — последний id', async () => {
    mocks.findAuditPageAfter.mockResolvedValue([row('a1'), row('a2', { chainSeq: 12n, rowHash: 'ff' })])
    const page = await exportAuditEntries(admin, { after_id: 'a0', limit: 2 })
    const lines = page.body.trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({
      id: 'a1',
      userId: 'u1',
      action: 'user.block',
      objectType: 'User',
      objectId: 'u2',
      payload: { source: 'x' },
      createdAt: '2026-09-26T10:00:00.000Z',
    })
    expect(lines[1]).toMatchObject({ chainSeq: '12', rowHash: 'ff' })
    expect(page).toMatchObject({ count: 2, lastId: 'a2' })
    expect(mocks.findAuditPageAfter).toHaveBeenCalledWith('a0', 2)
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'audit.export', payload: { afterId: 'a0', limit: 2, count: 2, lastId: 'a2' } }),
    )
  })

  it('пустая страница — пустое тело, курсора нет, выгрузка всё равно в журнале', async () => {
    mocks.findAuditPageAfter.mockResolvedValue([])
    expect(await exportAuditEntries(admin, { limit: 1000 })).toEqual({ body: '', count: 0, lastId: null })
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1)
  })

  it('потерянный курсор — 422 по after_id', async () => {
    mocks.findAuditPageAfter.mockResolvedValue(null)
    await expect(exportAuditEntries(admin, { after_id: 'gone', limit: 10 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('не администратор — 403 до чтения журнала', async () => {
    await expect(exportAuditEntries({ ...admin, role: 'MANAGER' }, { limit: 10 })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(mocks.findAuditPageAfter).not.toHaveBeenCalled()
  })

  it('limit: по умолчанию 1000, больше 5000 — отказ', () => {
    expect(auditExportQuerySchema.parse({}).limit).toBe(1000)
    expect(auditExportQuerySchema.safeParse({ limit: '5001' }).success).toBe(false)
  })
})
