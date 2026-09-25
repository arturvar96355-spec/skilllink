import { describe, expect, it, vi } from 'vitest'
import type { UserRole } from '@/shared/contracts/enums'

/**
 * Проверяется сам порядок выбора демо-пользователя — функция из `current-user.ts`.
 * Порядок элементов IN в SQL не сохраняется, поэтому приоритет ролей задаётся в коде:
 * без него вместо менеджера подставлялся бы тот, кто создан первым.
 * База, NextAuth и cookie подменены: функция чистая, им здесь делать нечего.
 */
vi.mock('./auth', () => ({ auth: vi.fn() }))
vi.mock('@/shared/db/prisma', () => ({ prisma: {} }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))

const { pickDefault } = await import('./current-user')

describe('пользователь по умолчанию', () => {
  it('выбирается менеджер, даже если администратор создан раньше', () => {
    const candidates = [
      { id: 'admin', role: 'ADMIN' as UserRole },
      { id: 'manager', role: 'MANAGER' as UserRole },
    ]
    expect(pickDefault(candidates)?.id).toBe('manager')
  })

  it('без менеджера берётся администратор', () => {
    const candidates = [
      { id: 'viewer', role: 'VIEWER' as UserRole },
      { id: 'admin', role: 'ADMIN' as UserRole },
    ]
    expect(pickDefault(candidates)?.id).toBe('admin')
  })

  it('порядок ролей соблюдается до конца списка', () => {
    const candidates = [
      { id: 'viewer', role: 'VIEWER' as UserRole },
      { id: 'analyst', role: 'ANALYST' as UserRole },
    ]
    expect(pickDefault(candidates)?.id).toBe('analyst')
  })

  it('на пустом списке пользователя нет', () => {
    expect(pickDefault([])).toBeUndefined()
  })
})
