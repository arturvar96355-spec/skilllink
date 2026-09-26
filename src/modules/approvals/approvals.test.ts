import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { ApprovalStatus } from '@/shared/contracts/approval'
import { approvalPayloadHash, canonicalJson, userChangeApprovals } from './approvals.rules'

/**
 * «Четыре глаза» (решение 133). Таблица одобрений — в памяти теста с той же
 * семантикой условных UPDATE, что в approvals.repo.ts: одна строка меняется,
 * только если выполнено всё условие.
 */
interface Row {
  id: string
  action: string
  payload: Record<string, unknown>
  payloadHash: string
  status: ApprovalStatus
  requestedById: string
  approvedById: string | null
  rejectedById: string | null
  createdAt: Date
  decidedAt: Date | null
  expiresAt: Date
  consumedAt: Date | null
}

const mocks = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  users: new Map<string, { id: string; role: string; isActive: boolean }>(),
  audit: [] as Array<{ action: string; objectId: string; payload?: unknown }>,
}))

const ref = (id: string | null) => (id ? { id, fullName: `Имя ${id}`, role: 'ADMIN' } : null)
const view = (row: Row) => ({ ...row, requestedBy: ref(row.requestedById), approvedBy: ref(row.approvedById), rejectedBy: ref(row.rejectedById) })
const rows = () => mocks.rows as Map<string, Row>

vi.mock('./approvals.repo', () => ({
  create: async (data: Omit<Row, 'id' | 'status' | 'approvedById' | 'rejectedById' | 'createdAt' | 'decidedAt' | 'consumedAt'>) => {
    const row: Row = { id: `a${rows().size + 1}`, status: 'REQUESTED', approvedById: null, rejectedById: null, createdAt: new Date(), decidedAt: null, consumedAt: null, ...data }
    rows().set(row.id, row)
    return view(row)
  },
  findById: async (id: string) => (rows().has(id) ? view(rows().get(id)!) : null),
  expireStale: async (now: Date) => {
    for (const row of rows().values()) if ((row.status === 'REQUESTED' || row.status === 'APPROVED') && row.expiresAt <= now) row.status = 'EXPIRED'
  },
  list: async () => ({ rows: [...rows().values()].map(view), total: rows().size }),
  approve: async (id: string, approverId: string, now: Date) => {
    const row = rows().get(id)
    if (!row || row.status !== 'REQUESTED' || row.requestedById === approverId || row.expiresAt <= now) return false
    Object.assign(row, { status: 'APPROVED', approvedById: approverId, decidedAt: now })
    return true
  },
  reject: async (id: string, rejectorId: string, now: Date) => {
    const row = rows().get(id)
    if (!row || !['REQUESTED', 'APPROVED'].includes(row.status) || row.expiresAt <= now) return false
    Object.assign(row, { status: 'REJECTED', rejectedById: rejectorId, decidedAt: now })
    return true
  },
  consume: async (input: { id: string; action: string; payloadHash: string; requestedById: string }, now: Date) => {
    const row = rows().get(input.id)
    if (!row || row.status !== 'APPROVED' || row.action !== input.action || row.payloadHash !== input.payloadHash) return false
    if (row.requestedById !== input.requestedById || row.expiresAt <= now) return false
    Object.assign(row, { status: 'CONSUMED', consumedAt: now })
    return true
  },
  findUserForApproval: async (id: string) => mocks.users.get(id) ?? null,
}))
vi.mock('@/shared/audit/audit', () => ({
  writeAudit: async (entry: { action: string; objectId: string; payload?: unknown }) => {
    mocks.audit.push(entry)
  },
}))

const service = await import('./approvals.service')

const admin = (id: string, role: CurrentUser['role'] = 'ADMIN'): CurrentUser => ({ id, email: `${id}@x.test`, fullName: id, role, universityId: null })
const alice = admin('alice')
const bob = admin('bob')

beforeEach(() => {
  mocks.rows.clear()
  mocks.audit.length = 0
  mocks.users.clear()
  mocks.users.set('target', { id: 'target', role: 'MANAGER', isActive: true })
  mocks.users.set('other-admin', { id: 'other-admin', role: 'ADMIN', isActive: true })
  vi.stubEnv('APPROVALS_REQUIRED', 'true')
})
afterEach(() => vi.unstubAllEnvs())

describe('правила', () => {
  it('хеш не зависит от порядка ключей и различает действие и параметры', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
    const hash = approvalPayloadHash('user.grant_admin', { userId: 'u1' })
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(approvalPayloadHash('user.grant_admin', { userId: 'u2' })).not.toBe(hash)
    expect(approvalPayloadHash('user.block_admin', { userId: 'u1' })).not.toBe(hash)
  })

  it('что требует одобрения: назначение администратором и блокировка администратора', () => {
    expect(userChangeApprovals({ role: 'MANAGER', isActive: true }, { role: 'ADMIN', isActive: true })).toEqual(['user.grant_admin'])
    expect(userChangeApprovals({ role: 'ADMIN', isActive: true }, { role: 'ADMIN', isActive: false })).toEqual(['user.block_admin'])
    expect(userChangeApprovals({ role: 'ADMIN', isActive: true }, { role: 'ADMIN', isActive: true })).toEqual([])
    expect(userChangeApprovals({ role: 'MANAGER', isActive: true }, { role: 'MANAGER', isActive: false })).toEqual([])
    expect(userChangeApprovals({ role: 'ADMIN', isActive: false }, { role: 'ADMIN', isActive: true })).toEqual([])
  })
})

describe('поток одобрения', () => {
  it('A запрашивает, B одобряет, A выполняет — одобрение срабатывает ровно один раз', async () => {
    const request = await service.request(alice, { action: 'user.grant_admin', payload: { userId: 'target' } })
    expect(request.status).toBe('REQUESTED')
    expect(request.canApprove).toBe(false)

    await expect(service.approve(alice, request.id)).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('Свой запрос') })
    const approved = await service.approve(bob, request.id)
    expect(approved).toMatchObject({ status: 'APPROVED', approvedBy: { id: 'bob' } })

    const context = { actor: alice, approvalId: request.id }
    await expect(service.requireApproval('user.grant_admin', { userId: 'target' }, context)).resolves.toBe(true)
    await expect(service.requireApproval('user.grant_admin', { userId: 'target' }, context)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: { approvalRequired: true },
    })
    expect(mocks.audit.map((entry) => entry.action)).toEqual(['approval.requested', 'approval.approved', 'approval.consumed'])
  })

  it('одновременное использование: из двух попыток проходит одна', async () => {
    const { id } = await service.request(alice, { action: 'user.grant_admin', payload: { userId: 'target' } })
    await service.approve(bob, id)
    const results = await Promise.allSettled([
      service.requireApproval('user.grant_admin', { userId: 'target' }, { actor: alice, approvalId: id }),
      service.requireApproval('user.grant_admin', { userId: 'target' }, { actor: alice, approvalId: id }),
    ])
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
  })

  it('одобрение не подходит к другой операции, другим параметрам и другому исполнителю', async () => {
    const { id } = await service.request(alice, { action: 'user.grant_admin', payload: { userId: 'target' } })
    await service.approve(bob, id)
    for (const [action, payload, actor] of [
      ['user.block_admin', { userId: 'target' }, alice],
      ['user.grant_admin', { userId: 'someone-else' }, alice],
      ['user.grant_admin', { userId: 'target' }, bob],
    ] as const) {
      await expect(service.requireApproval(action, payload, { actor, approvalId: id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    // Не потрачено — подходящая операция всё ещё проходит.
    await expect(service.requireApproval('user.grant_admin', { userId: 'target' }, { actor: alice, approvalId: id })).resolves.toBe(true)
  })

  it('без одобрения, с ждущим или отклонённым — 403; истёкшее — 403 и в списке EXPIRED', async () => {
    await expect(service.requireApproval('user.grant_admin', { userId: 'target' }, { actor: alice })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const pending = await service.request(alice, { action: 'user.grant_admin', payload: { userId: 'target' } })
    await expect(
      service.requireApproval('user.grant_admin', { userId: 'target' }, { actor: alice, approvalId: pending.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await service.reject(alice, pending.id)
    await expect(service.approve(bob, pending.id)).rejects.toMatchObject({ code: 'CONFLICT' })

    const old = await service.request(alice, { action: 'user.grant_admin', payload: { userId: 'target' } }, new Date(Date.now() - 48 * 3600_000))
    await expect(service.approve(bob, old.id)).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('истёк') })
    const listed = await service.list(alice, { page: 1, pageSize: 20 })
    expect(listed.data.find((item) => item.id === old.id)?.status).toBe('EXPIRED')
  })

  it('выключено (APPROVALS_REQUIRED не задан) — requireApproval ничего не требует', async () => {
    vi.stubEnv('APPROVALS_REQUIRED', '')
    await expect(service.requireApproval('user.grant_admin', { userId: 'target' }, { actor: alice })).resolves.toBe(false)
  })

  it('запрос проверяет цель и параметры; не администратор — 403', async () => {
    await expect(service.request(alice, { action: 'user.grant_admin', payload: { userId: 'other-admin' } })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(service.request(alice, { action: 'user.block_admin', payload: { userId: 'target' } })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(service.request(alice, { action: 'user.grant_admin', payload: { userId: 'nobody' } })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(service.request(alice, { action: 'user.grant_admin', payload: { userId: 'target', email: 'x@y.ru' } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(service.request(admin('m', 'MANAGER'), { action: 'user.grant_admin', payload: { userId: 'target' } })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
