import { describe, expect, it } from 'vitest'

import { diagnoseDatabaseError } from './database-error'

/**
 * Образцы взяты с живого сервера: Prisma 7 с адаптером `@prisma/adapter-pg`
 * отдаёт все четыре случая одним кодом P2010, различаются они только полем
 * `kind` внутри ошибки драйвера.
 */
function prismaError(cause: Record<string, unknown>): unknown {
  return Object.assign(new Error('Raw query failed. Code: `P2010`'), {
    code: 'P2010',
    meta: { driverAdapterError: { name: 'DriverAdapterError', cause } },
  })
}

describe('разбор ошибки обращения к базе', () => {
  it('неверный пароль — это не «база недоступна»', () => {
    const diagnosis = diagnoseDatabaseError(
      prismaError({
        originalCode: '28P01',
        originalMessage: 'password authentication failed for user "skilllink"',
        kind: 'AuthenticationFailed',
        user: 'skilllink',
      }),
    )
    expect(diagnosis.database).toBe('auth-failed')
    expect(diagnosis.hint).toContain('пароль')
  })

  it('сервер не отвечает', () => {
    const diagnosis = diagnoseDatabaseError(
      prismaError({ kind: 'DatabaseNotReachable', host: '172.18.0.2', port: 5999 }),
    )
    expect(diagnosis.database).toBe('unreachable')
  })

  it('нет такой базы', () => {
    const diagnosis = diagnoseDatabaseError(
      prismaError({ originalCode: '3D000', kind: 'DatabaseDoesNotExist', db: 'nosuchdb' }),
    )
    expect(diagnosis.database).toBe('database-missing')
  })

  it('незнакомая ошибка считается недоступностью, а не молчит', () => {
    expect(diagnoseDatabaseError(prismaError({ kind: 'SomethingNew' })).database).toBe('unreachable')
    expect(diagnoseDatabaseError(new Error('совсем другое')).database).toBe('unreachable')
    expect(diagnoseDatabaseError(null).database).toBe('unreachable')
    expect(diagnoseDatabaseError({ meta: { driverAdapterError: null } }).database).toBe('unreachable')
  })
})
