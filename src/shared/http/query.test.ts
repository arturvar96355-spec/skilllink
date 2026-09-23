import { describe, expect, it } from 'vitest'
import { z } from '@/shared/zod'
import { parseQuery } from './request'

const schema = z.object({ q: z.string().trim().min(1).optional(), status: z.string().optional() })

describe('параметры запроса', () => {
  it('значение из одних пробелов — как отсутствие, а не отказ', () => {
    // Поиск из пробела на страницах программ и продуктов заменял таблицу ошибкой.
    expect(parseQuery(new Request('http://localhost/api/programs?q=%20%20&status=ACTIVE'), schema)).toEqual({
      status: 'ACTIVE',
    })
  })

  it('пустое значение — тоже', () => {
    expect(parseQuery(new Request('http://localhost/api/programs?q='), schema)).toEqual({})
  })

  it('обычное значение передаётся', () => {
    expect(parseQuery(new Request('http://localhost/api/programs?q=%20инж%20'), schema)).toEqual({ q: 'инж' })
  })
})
