import { describe, expect, it, vi } from 'vitest'
import { createAutoRefresh } from './recommendations.refresh'

/**
 * «Список задач» пересобирается сам (решение 212): кнопки «Пересобрать» в
 * интерфейсе нет, поэтому устаревший список обязан обновиться при чтении.
 */
const MINUTE = 60_000

function setup(lastRun: Date | null, at = new Date('2026-09-28T10:00:00Z')) {
  let clock = at.getTime()
  let last = lastRun
  const run = vi.fn(async () => {
    last = new Date(clock)
  })
  const lastRunAt = vi.fn(async () => last)
  const ensureFresh = createAutoRefresh({ lastRunAt, run, now: () => new Date(clock), maxAgeMs: 10 * MINUTE })
  return {
    ensureFresh,
    run,
    lastRunAt,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe('автоматическая пересборка списка задач', () => {
  it('ни разу не собирался — собирается при первом чтении', async () => {
    const { ensureFresh, run } = setup(null)
    await ensureFresh()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('последняя пересборка старше срока — собирается заново', async () => {
    const { ensureFresh, run } = setup(new Date('2026-09-28T09:30:00Z'))
    await ensureFresh()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('свежий список не пересобирается, и база повторно не спрашивается', async () => {
    const { ensureFresh, run, lastRunAt } = setup(new Date('2026-09-28T09:55:00Z'))
    await ensureFresh()
    await ensureFresh()
    expect(run).not.toHaveBeenCalled()
    expect(lastRunAt).toHaveBeenCalledTimes(1)
  })

  it('через срок после пересборки — снова собирается', async () => {
    const { ensureFresh, run, advance } = setup(null)
    await ensureFresh()
    advance(11 * MINUTE)
    await ensureFresh()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('одновременные чтения ждут одну пересборку', async () => {
    const { ensureFresh, run } = setup(null)
    await Promise.all([ensureFresh(), ensureFresh(), ensureFresh()])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('сбой пересборки чтение не ломает и сразу не повторяется', async () => {
    const onError = vi.fn()
    const run = vi.fn(async () => {
      throw new Error('база недоступна')
    })
    const ensureFresh = createAutoRefresh({
      lastRunAt: async () => null,
      run,
      now: () => new Date('2026-09-28T10:00:00Z'),
      maxAgeMs: 10 * MINUTE,
      onError,
    })
    await expect(ensureFresh()).resolves.toBeUndefined()
    await ensureFresh()
    expect(run).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
