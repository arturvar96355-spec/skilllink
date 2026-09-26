import { describe, expect, it, vi } from 'vitest'
import { createTtlMemo } from './ttl-memo'

describe('createTtlMemo', () => {
  it('второй вызов с тем же ключом в пределах TTL не пересчитывает', async () => {
    const compute = vi.fn(async () => 'значение')
    const memo = createTtlMemo<string, string>(60_000)

    const at0 = new Date('2026-09-27T00:00:00.000Z')
    await memo('scope-1', at0, compute)
    const at1 = new Date(at0.getTime() + 30_000)
    await memo('scope-1', at1, compute)

    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('после истечения TTL пересчитывает заново', async () => {
    const compute = vi.fn(async () => 'значение')
    const memo = createTtlMemo<string, string>(60_000)

    const at0 = new Date('2026-09-27T00:00:00.000Z')
    await memo('scope-1', at0, compute)
    const at1 = new Date(at0.getTime() + 60_001)
    await memo('scope-1', at1, compute)

    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('разные ключи (область видимости) не делят одну запись', async () => {
    const compute = vi.fn(async (key: string) => `значение-${key}`)
    const memo = createTtlMemo<string, string>(60_000)
    const now = new Date('2026-09-27T00:00:00.000Z')

    const a = await memo('uni-1', now, () => compute('uni-1'))
    const b = await memo('uni-2', now, () => compute('uni-2'))

    expect(compute).toHaveBeenCalledTimes(2)
    expect(a).toBe('значение-uni-1')
    expect(b).toBe('значение-uni-2')
  })

  it('сбой не запоминается — следующий вызов пробует снова, а не повторяет ошибку', async () => {
    const compute = vi.fn().mockRejectedValueOnce(new Error('сбой базы')).mockResolvedValueOnce('ок')
    const memo = createTtlMemo<string, string>(60_000)
    const now = new Date('2026-09-27T00:00:00.000Z')

    await expect(memo('scope-1', now, compute)).rejects.toThrow('сбой базы')
    // Тот же момент времени (в пределах TTL) — но кеш не держит упавший промис.
    await expect(memo('scope-1', now, compute)).resolves.toBe('ок')
    expect(compute).toHaveBeenCalledTimes(2)
  })
})
