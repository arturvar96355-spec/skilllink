import { describe, expect, it } from 'vitest'
import { exampleFromSchema } from './example'

describe('exampleFromSchema — черновик тела для /api-docs (решение 146)', () => {
  it('заполняет только обязательные поля объекта', () => {
    const schema = {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        normativeDays: { type: 'integer' },
      },
    }
    expect(exampleFromSchema(schema)).toEqual({ title: '' })
  })

  it('берёт первое значение enum', () => {
    expect(exampleFromSchema({ type: 'string', enum: ['ACTIVE', 'PAUSED'] })).toBe('ACTIVE')
  })

  it('anyOf/oneOf — первый вариант, не null', () => {
    expect(exampleFromSchema({ anyOf: [{ type: 'null' }, { type: 'string' }] })).toBe('')
  })

  it('примитивы', () => {
    expect(exampleFromSchema({ type: 'integer' })).toBe(0)
    expect(exampleFromSchema({ type: 'boolean' })).toBe(false)
    expect(exampleFromSchema({ type: 'array' })).toEqual([])
  })

  it('пустая схема — undefined, без падения', () => {
    expect(exampleFromSchema(null)).toBeUndefined()
    expect(exampleFromSchema(undefined)).toBeUndefined()
  })
})
