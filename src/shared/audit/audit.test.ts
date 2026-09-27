import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `recordAuditOnce` (решение 200): одна запись на «действие + объект + автор» в окне,
 * под рекомендательной блокировкой; сбой базы не проглатывается. Журнал в памяти теста.
 */

interface Row {
  userId: string
  action: string
  objectType: string
  objectId: string
  createdAt: Date
}

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  locks: [] as string[],
  failCreate: false,
  clock: new Date('2026-09-28T11:05:00Z'),
}))

vi.mock('@/shared/db/prisma', () => {
  const tx = {
    $executeRaw: vi.fn(async (_strings: TemplateStringsArray, key: string) => {
      state.locks.push(key)
      return 1
    }),
    auditLog: {
      findFirst: vi.fn(async ({ where }: { where: Row & { createdAt: { gte: Date } } }) => {
        const found = state.rows.find(
          (row) =>
            row.action === where.action &&
            row.objectType === where.objectType &&
            row.objectId === where.objectId &&
            row.userId === where.userId &&
            row.createdAt >= where.createdAt.gte,
        )
        return found ? { createdAt: found.createdAt } : null
      }),
      create: vi.fn(async ({ data }: { data: Omit<Row, 'createdAt'> }) => {
        if (state.failCreate) throw new Error('база недоступна')
        const row = { ...data, createdAt: state.clock }
        state.rows.push(row)
        return { createdAt: row.createdAt }
      }),
    },
  }
  return { prisma: { $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) } }
})

const { recordAuditOnce } = await import('./audit')

const entry = {
  userId: 'user-1',
  action: 'stage.accept' as const,
  objectType: 'WorkflowStage',
  objectId: 'stage-3',
  payload: { source: 'telegram' },
}
const WEEK_AGO = new Date('2026-09-21T11:05:00Z')

beforeEach(() => {
  state.rows = []
  state.locks = []
  state.failCreate = false
})

describe('recordAuditOnce', () => {
  it('первое нажатие пишет, второе — нет, и отдаёт время первого', async () => {
    expect(await recordAuditOnce(entry, WEEK_AGO)).toEqual({ created: true, at: state.clock })
    const first = state.clock
    state.clock = new Date('2026-09-28T12:00:00Z')
    expect(await recordAuditOnce(entry, WEEK_AGO)).toEqual({ created: false, at: first })
    expect(state.rows).toHaveLength(1)
    // Блокировка — на ключ «действие + объект + автор», без персональных данных.
    expect(state.locks).toEqual([
      'audit-once:stage.accept:WorkflowStage:stage-3:user-1',
      'audit-once:stage.accept:WorkflowStage:stage-3:user-1',
    ])
  })

  it('другой автор или запись старше окна — новая запись', async () => {
    state.rows.push({ ...entry, createdAt: new Date('2026-09-10T00:00:00Z') })
    expect((await recordAuditOnce(entry, WEEK_AGO)).created).toBe(true)
    expect((await recordAuditOnce({ ...entry, userId: 'user-2' }, WEEK_AGO)).created).toBe(true)
  })

  it('сбой базы не проглатывается — вызывающий должен знать, что отметки нет', async () => {
    state.failCreate = true
    await expect(recordAuditOnce(entry, WEEK_AGO)).rejects.toThrow('база недоступна')
  })
})
