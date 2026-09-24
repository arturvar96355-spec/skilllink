import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'
import {
  MATERIALS_STAGE_NUMBER,
  assertMaterialsTask,
  assertPortalWritable,
  resolvePortalUniversityId,
} from './portal.rules'
import {
  applicationListQuerySchema,
  submitApplicationSchema,
  updateProgramMetricsSchema,
} from './portal.schema'

const user = (role: UserRole, universityId: string | null = null): CurrentUser => ({
  id: 'user-1',
  email: 'demo@skilllink.demo',
  fullName: 'Демонстрационный Пользователь',
  role,
  universityId,
})

function expectError(fn: () => void, code: string): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
    return
  }
  throw new Error(`Ожидалась ошибка ${code}, но её не было`)
}

describe('определение вуза кабинета', () => {
  it('представитель работает со своим вузом и параметр игнорирует', () => {
    expect(resolvePortalUniversityId(user('UNIVERSITY_REP', 'uni-1'), 'uni-2')).toBe('uni-1')
  })

  it('представитель без назначенного вуза получает FORBIDDEN', () => {
    expectError(() => resolvePortalUniversityId(user('UNIVERSITY_REP', null), undefined), 'FORBIDDEN')
  })

  it('сотрудник обязан указать вуз явно', () => {
    expectError(() => resolvePortalUniversityId(user('MANAGER'), undefined), 'NOT_FOUND')
  })

  it('сотрудник открывает кабинет указанного вуза', () => {
    expect(resolvePortalUniversityId(user('MANAGER'), 'uni-7')).toBe('uni-7')
  })
})

describe('запись в кабинете вуза', () => {
  it('представитель вуза подтверждает, вносит показатели и подаёт заявки', () => {
    expect(() => assertPortalWritable(user('UNIVERSITY_REP', 'uni-1'))).not.toThrow()
  })

  it('сотрудник ИТ-Школы в кабинете вуза только просматривает', () => {
    // Раньше менеджер подтверждал получение материалов от имени вуза —
    // и подтверждение второй стороны в системе было его собственным.
    for (const role of ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'] as const) {
      expectError(() => assertPortalWritable(user(role)), 'FORBIDDEN')
    }
    try {
      assertPortalWritable(user('MANAGER'))
    } catch (error) {
      expect((error as AppError).message).toBe(
        'В кабинете вуза сотрудник только просматривает; подтверждает сам вуз',
      )
    }
  })
})

describe('подтверждение материалов', () => {
  it('подтверждать можно только задачи этапа передачи материалов', () => {
    expect(MATERIALS_STAGE_NUMBER).toBe(7)
    expect(() => assertMaterialsTask(7)).not.toThrow()
  })

  it('задача другого этапа не подтверждается через кабинет', () => {
    expectError(() => assertMaterialsTask(6), 'NOT_FOUND')
    expectError(() => assertMaterialsTask(11), 'NOT_FOUND')
  })
})

describe('показатели, которые вносит вуз', () => {
  it('принимает численность обучающихся и количество групп', () => {
    const parsed = updateProgramMetricsSchema.safeParse({ studentCount: 120, groupCount: 5 })
    expect(parsed.success).toBe(true)
  })

  it('допускает null — это «Нет данных»', () => {
    expect(updateProgramMetricsSchema.safeParse({ studentCount: null }).success).toBe(true)
  })

  it('не принимает заявки: они считаются по поданным заявкам', () => {
    const parsed = updateProgramMetricsSchema.safeParse({ applicationCount: 500 })
    expect(parsed.success).toBe(false)
  })

  it('не принимает пустое тело', () => {
    expect(updateProgramMetricsSchema.safeParse({}).success).toBe(false)
  })

  it('отклоняет отрицательные значения', () => {
    expect(updateProgramMetricsSchema.safeParse({ groupCount: -1 }).success).toBe(false)
  })
})

describe('заявка на обучение', () => {
  const valid = { programId: 'prog-1', quantity: 10 }

  it('принимает количество и комментарий', () => {
    expect(submitApplicationSchema.safeParse({ ...valid, comment: 'Весенний набор' }).success).toBe(
      true,
    )
  })

  it('требует программу', () => {
    expect(submitApplicationSchema.safeParse({ quantity: 10 }).success).toBe(false)
  })

  it('количество не меньше единицы', () => {
    expect(submitApplicationSchema.safeParse({ ...valid, quantity: 0 }).success).toBe(false)
  })

  it('не принимает персональные данные обучающихся', () => {
    // Схема strip-режима отбрасывает неизвестные поля: ФИО в заявку не попадёт.
    const parsed = submitApplicationSchema.parse({
      ...valid,
      studentName: 'Иванов Иван Иванович',
      studentEmail: 'ivanov@example.invalid',
    } as Record<string, unknown>)
    expect('studentName' in parsed).toBe(false)
    expect('studentEmail' in parsed).toBe(false)
  })

  it('список заявок принимает фильтр по статусу', () => {
    expect(applicationListQuerySchema.safeParse({ status: 'CONFIRMED' }).success).toBe(true)
    expect(applicationListQuerySchema.safeParse({ status: 'UNKNOWN' }).success).toBe(false)
  })
})
