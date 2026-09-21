import { describe, expect, it } from 'vitest'
import type { UserRole } from '@/shared/contracts/enums'

/**
 * Проверяется сам порядок выбора демо-пользователя.
 * Раньше приоритет задавался списком в `role: { in: [...] }`, а сортировка шла по дате
 * создания — порядок элементов IN в SQL не сохраняется, и вместо менеджера система
 * подставляла того, кто был создан первым.
 */
const DEFAULT_ROLE_ORDER: UserRole[] = ['MANAGER', 'ADMIN', 'ANALYST', 'VIEWER']

function pickDefault<T extends { role: UserRole }>(candidates: T[]): T | undefined {
  return candidates
    .slice()
    .sort((a, b) => DEFAULT_ROLE_ORDER.indexOf(a.role) - DEFAULT_ROLE_ORDER.indexOf(b.role))[0]
}

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
