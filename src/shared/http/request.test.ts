import { describe, expect, it, vi } from 'vitest'
import { z } from '@/shared/zod'
import { AppError } from './errors'
import { describeForLog } from '@/shared/db/log'
import { handle, toAppError } from './handle'
import { parseBody, parseOptionalBody, parseQuery } from './request'

const schema = z.object({ name: z.string(), q: z.string().optional() })

const post = (body: string): Request =>
  new Request('http://localhost/api/x', { method: 'POST', body, headers: { 'content-type': 'application/json' } })

async function codeOf(action: () => unknown): Promise<string | null> {
  try {
    await action()
    return null
  } catch (error) {
    return error instanceof AppError ? `${error.code}:${JSON.stringify(error.details)}` : 'другая ошибка'
  }
}

/**
 * Символ с кодом 0 PostgreSQL не принимает: без проверки на входе запрос
 * доходил до базы и отвечал 500 на двадцати маршрутах (shared/db/storable.ts).
 */
describe('символ с кодом 0 останавливается на входе', () => {
  it('в теле — ошибка валидации с именем поля', async () => {
    const code = await codeOf(() => parseBody(post('{"name":"Вуз\\u0000"}'), schema))
    expect(code).toContain('VALIDATION_ERROR')
    expect(code).toContain('"field":"name"')
  })

  it('в необязательном теле — тоже', async () => {
    const code = await codeOf(() => parseOptionalBody(post('{"name":"\\u0000"}'), schema))
    expect(code).toContain('VALIDATION_ERROR')
  })

  it('в параметрах запроса — тоже', async () => {
    const request = new Request('http://localhost/api/x?name=a&q=%00')
    const code = await codeOf(() => parseQuery(request, schema))
    expect(code).toContain('"field":"q"')
  })

  it('в пути — «не найдено», и обработчик не вызывается', async () => {
    const inner = vi.fn(async () => new Response('{}'))
    const route = handle<{ params: Promise<{ id: string }> }>(inner)
    const response = await route(new Request('http://localhost/api/x'), {
      params: Promise.resolve({ id: 'abc\u0000' }),
    })
    expect(response.status).toBe(404)
    expect(inner).not.toHaveBeenCalled()
  })

  it('обычный путь до обработчика доходит', async () => {
    const route = handle<{ params: Promise<{ id: string }> }>(async () => new Response('ok'))
    const response = await route(new Request('http://localhost/api/x'), {
      params: Promise.resolve({ id: 'cmudwcm85002w2irlsbmc4wq3' }),
    })
    expect(await response.text()).toBe('ok')
  })
})

describe('внутренняя ошибка', () => {
  /** Так выглядит сообщение Prisma: вызов целиком, с данными, и причина последней строкой. */
  const prismaError = Object.assign(
    new Error(
      '\nInvalid `prisma.contact.create()` invocation:\n\n{\n  data: {\n    fullName: "Иванов Иван",\n    email: "ivanov@example.ru"\n  }\n}\n\nValue out of range for the type.',
    ),
    { name: 'PrismaClientKnownRequestError' },
  )

  it('в журнал — без данных запроса', () => {
    const line = describeForLog(prismaError)
    expect(line).toContain('Value out of range for the type.')
    expect(line).not.toContain('Иванов')
    expect(line).not.toContain('ivanov@')
  })

  it('клиенту не показывается', () => {
    expect(toAppError(prismaError)).toBeNull()
  })
})
