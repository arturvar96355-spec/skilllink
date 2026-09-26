import { describe, expect, it, vi } from 'vitest'
import { z } from '@/shared/zod'
import { AppError } from './errors'
import { handle, toAppError } from './handle'
import { MAX_JSON_BODY_BYTES, parseBody, parseOptionalBody, parseQuery } from './request'

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

  // Что такая ошибка не попадает в журнал с данными запроса — проверяет
  // src/shared/log/log.test.ts («ошибка Prisma: от сообщения — только последняя
  // строка»): та же маскировка, но через единственный путь (`redact`/`log`,
  // src/shared/log), решение 173 — до него здесь дублировался отдельный,
  // более слабый `describeForLog` (`src/shared/db/log.ts`, удалён).

  it('клиенту не показывается', () => {
    expect(toAppError(prismaError)).toBeNull()
  })
})

describe('нарушение CHECK-ограничения базы', () => {
  // Так ошибку отдаёт Prisma с адаптером драйвера (снято с настоящей базы).
  const checkError = Object.assign(new Error('Database error. Code: `23514`.'), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2039',
    meta: {
      modelName: 'EducationalProgram',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '23514',
          originalMessage:
            'new row for relation "educational_programs" violates check constraint "educational_programs_student_count_check"',
          detail: 'Failing row contains (cm1, Иванов Иван, ivanov@example.ru, -1).',
        },
      },
    },
  })

  it('это ошибка ввода 422 с именем ограничения, а не внутренняя 500', () => {
    const known = toAppError(checkError)
    expect(known?.code).toBe('VALIDATION_ERROR')
    expect(known?.details).toEqual({ constraint: 'educational_programs_student_count_check' })
  })

  it('содержимое строки наружу не уходит', () => {
    const known = toAppError(checkError)
    const shown = JSON.stringify({ message: known?.message, details: known?.details })
    expect(shown).not.toContain('Иванов')
    expect(shown).not.toContain('Failing row')
  })
})

describe('размер тела', () => {
  /** Поток без Content-Length — как при передаче chunked. */
  function streamed(totalBytes: number, onPull: () => void): Request {
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        onPull()
        if (sent >= totalBytes) return controller.close()
        const chunk = new TextEncoder().encode('a'.repeat(64 * 1024))
        sent += chunk.byteLength
        controller.enqueue(chunk)
      },
    })
    return new Request('http://localhost/api/x', { method: 'POST', body, duplex: 'half' } as RequestInit)
  }

  it('тело без длины в заголовке обрывается на пределе, а не читается целиком', async () => {
    // Раньше request.json() дочитывал всё присланное — хоть гигабайты.
    let pulls = 0
    const request = streamed(50 * MAX_JSON_BODY_BYTES, () => (pulls += 1))
    const code = await codeOf(() => parseBody(request, schema))
    expect(code).toContain('VALIDATION_ERROR')
    expect(pulls * 64 * 1024).toBeLessThan(2 * MAX_JSON_BODY_BYTES)
  })

  it('заявленная длина больше предела — отказ без чтения', async () => {
    const request = new Request('http://localhost/api/x', {
      method: 'POST',
      body: '{}',
      headers: { 'content-length': String(MAX_JSON_BODY_BYTES + 1) },
    })
    expect(await codeOf(() => parseBody(request, schema))).toContain('VALIDATION_ERROR')
  })

  it('обычное тело читается как раньше', async () => {
    expect(await parseBody(post('{"name":"Вуз"}'), schema)).toEqual({ name: 'Вуз' })
    expect(await parseOptionalBody(post(''), z.object({ force: z.boolean().optional() }))).toEqual({})
  })
})

