import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import {
  createUniversitySchema,
  universityListQuerySchema,
  updateUniversitySchema,
} from './universities.schema'
import { assertCanArchive, assertNotArchived } from './universities.rules'

describe('валидация вуза', () => {
  it('принимает минимально заполненную запись', () => {
    const parsed = createUniversitySchema.safeParse({
      name: 'Тестовый университет связи',
      city: 'Москва',
      region: 'Москва',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.status).toBe('NEW')
  })

  it('отклоняет слишком короткое название', () => {
    const parsed = createUniversitySchema.safeParse({ name: 'АБ', city: 'Москва', region: 'Москва' })
    expect(parsed.success).toBe(false)
    expect(parsed.success === false && parsed.error.issues[0]?.message).toContain('3 символов')
  })

  it('отклоняет некорректный сайт', () => {
    const parsed = createUniversitySchema.safeParse({
      name: 'Тестовый университет связи',
      city: 'Москва',
      region: 'Москва',
      website: 'не-ссылка',
    })
    expect(parsed.success).toBe(false)
  })

  it('не принимает пустое тело изменения', () => {
    expect(updateUniversitySchema.safeParse({}).success).toBe(false)
  })
})

describe('параметры списка', () => {
  it('подставляет пагинацию по умолчанию', () => {
    const parsed = universityListQuerySchema.parse({})
    expect(parsed.page).toBe(1)
    expect(parsed.pageSize).toBe(20)
  })

  it('приводит одиночный статус к массиву', () => {
    const parsed = universityListQuerySchema.parse({ status: 'ACTIVE' })
    expect(parsed.status).toEqual(['ACTIVE'])
  })

  it('принимает несколько статусов', () => {
    const parsed = universityListQuerySchema.parse({ status: ['ACTIVE', 'NEW'] })
    expect(parsed.status).toEqual(['ACTIVE', 'NEW'])
  })

  it('отклоняет неизвестный статус', () => {
    expect(universityListQuerySchema.safeParse({ status: 'WRONG' }).success).toBe(false)
  })

  it('ограничивает размер страницы', () => {
    expect(universityListQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false)
  })
})

describe('правила архивирования', () => {
  it('не даёт архивировать вуз с незакрытыми связями', () => {
    expect(() => assertCanArchive(2)).toThrowError(AppError)
  })

  it('архивирует вуз без связей', () => {
    expect(() => assertCanArchive(0)).not.toThrow()
  })

  it('не даёт править архивную запись', () => {
    expect(() => assertNotArchived(new Date())).toThrowError(AppError)
    expect(() => assertNotArchived(null)).not.toThrow()
  })
})
