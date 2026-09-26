import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import { withIdempotency, type IdempotencyStore } from './idempotency'
import type { IdempotencyRow } from './idempotency.repo'

/**
 * Хранилище в памяти с той же семантикой, что у таблицы: захват — атомарная
 * вставка «если нет» (в одном потоке JS проверка и запись не разделяются),
 * первичный ключ — пользователь + ключ. Между шагами — await, как у базы.
 */
function memoryStore(): IdempotencyStore & { rows: Map<string, IdempotencyRow> } {
  const rows = new Map<string, IdempotencyRow>()
  const id = (userId: string, key: string) => `${userId}\u0000${key}`
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  return {
    rows,
    async deleteExpired(userId, key, before) {
      await tick()
      const row = rows.get(id(userId, key))
      if (row && row.createdAt < before) rows.delete(id(userId, key))
    },
    async tryClaim(userId, key, requestHash) {
      await tick()
      if (rows.has(id(userId, key))) return false
      rows.set(id(userId, key), { requestHash, status: 'IN_PROGRESS', responseStatus: null, responseBody: null, createdAt: new Date() })
      return true
    },
    async find(userId, key) {
      await tick()
      return rows.get(id(userId, key)) ?? null
    },
    async complete(userId, key, status, body) {
      await tick()
      const row = rows.get(id(userId, key))!
      rows.set(id(userId, key), { ...row, status: 'SUCCEEDED', responseStatus: status, responseBody: body })
    },
    async release(userId, key) {
      await tick()
      if (rows.get(id(userId, key))?.status === 'IN_PROGRESS') rows.delete(id(userId, key))
    },
  }
}

function post(body: unknown, key: string | null = 'key-1', path = '/api/cooperations'): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key === null ? {} : { 'idempotency-key': key }) },
    body: JSON.stringify(body),
  })
}

/** «Создание»: читает тело, ждёт «базу», отдаёт 201 с новым id. */
function creator() {
  let created = 0
  const run = async (request: Request) => {
    const input = (await request.json()) as { name: string }
    await new Promise((resolve) => setTimeout(resolve, 5))
    created += 1
    return Response.json({ data: { id: `obj-${created}`, name: input.name } }, { status: 201 })
  }
  return { run, count: () => created }
}

async function codeOf(promise: Promise<Response>): Promise<number | string> {
  try {
    return (await promise).status
  } catch (error) {
    return error instanceof AppError ? error.status : 'throw'
  }
}

describe('ключ идемпотентности (решение 123)', () => {
  it('гонка: 10 одновременных запросов с одним ключом — создан ровно один объект', async () => {
    const store = memoryStore()
    const { run, count } = creator()
    const results = await Promise.all(
      Array.from({ length: 10 }, () => codeOf(withIdempotency(post({ name: 'A' }), 'user-1', run, store))),
    )
    expect(count()).toBe(1)
    expect(results.filter((status) => status === 201)).toHaveLength(1)
    // Остальные — «ещё выполняется»: клиент повторит и получит сохранённый ответ.
    expect(results.filter((status) => status === 409)).toHaveLength(9)

    const again = await withIdempotency(post({ name: 'A' }), 'user-1', run, store)
    expect(again.status).toBe(201)
    expect(again.headers.get('idempotency-replayed')).toBe('true')
    expect(await again.json()).toEqual({ data: { id: 'obj-1', name: 'A' } })
    expect(count()).toBe(1)
  })

  it('тот же ключ, другое тело — 422; другой путь — тоже другой запрос', async () => {
    const store = memoryStore()
    const { run } = creator()
    await withIdempotency(post({ name: 'A' }), 'u', run, store)
    await expect(withIdempotency(post({ name: 'B' }), 'u', run, store)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(withIdempotency(post({ name: 'A' }, 'key-1', '/api/meetings'), 'u', run, store)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('ключ принадлежит пользователю: другой с тем же ключом создаёт своё', async () => {
    const store = memoryStore()
    const { run, count } = creator()
    await withIdempotency(post({ name: 'A' }), 'u1', run, store)
    const other = await withIdempotency(post({ name: 'A' }), 'u2', run, store)
    expect(other.headers.get('idempotency-replayed')).toBeNull()
    expect(count()).toBe(2)
  })

  it('ошибка обработчика отпускает ключ: исправленный повтор выполняется', async () => {
    const store = memoryStore()
    let fail = true
    const run = async () => {
      if (fail) throw new AppError('VALIDATION_ERROR', 'нет вуза')
      return Response.json({ data: { id: 'x' } }, { status: 201 })
    }
    await expect(withIdempotency(post({ name: 'A' }), 'u', run, store)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(store.rows.size).toBe(0)
    fail = false
    expect((await withIdempotency(post({ name: 'A' }), 'u', run, store)).status).toBe(201)
  })

  it('ответ не 2xx не сохраняется', async () => {
    const store = memoryStore()
    const run = async () => Response.json({ error: { code: 'CONFLICT' } }, { status: 409 })
    expect((await withIdempotency(post({}), 'u', run, store)).status).toBe(409)
    expect(store.rows.size).toBe(0)
  })

  it('через 24 часа ключ истекает и выполняется заново', async () => {
    const store = memoryStore()
    const { run, count } = creator()
    await withIdempotency(post({ name: 'A' }), 'u', run, store)
    const later = () => new Date(Date.now() + 25 * 3600_000)
    const response = await withIdempotency(post({ name: 'A' }), 'u', run, store, later)
    expect(response.headers.get('idempotency-replayed')).toBeNull()
    expect(count()).toBe(2)
  })

  it('без заголовка — как раньше; кривой ключ — 422', async () => {
    const store = memoryStore()
    const { run, count } = creator()
    await withIdempotency(post({ name: 'A' }, null), 'u', run, store)
    await withIdempotency(post({ name: 'A' }, null), 'u', run, store)
    expect(count()).toBe(2)
    expect(store.rows.size).toBe(0)
    for (const bad of ['', 'with space', 'x'.repeat(256), 'tab\there']) {
      await expect(withIdempotency(post({}, bad), 'u', run, store)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    }
  })
})
