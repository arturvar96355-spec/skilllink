import { z } from '@/shared/zod'
import { findNul } from '@/shared/db/storable'
import { log } from '@/shared/log/logger'
import { runWithRequestId } from '@/shared/log/request-context'
import { AppError, fromZod, notFound } from './errors'
import { assertSameOrigin } from './origin'
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id'
import { fail } from './response'

interface PrismaLikeError {
  code: string
  meta?: Record<string, unknown>
}

/** Ошибки Prisma не импортируются по классам: у сгенерированного клиента свой путь сборки. */
function asPrismaError(error: unknown): PrismaLikeError | null {
  if (typeof error !== 'object' || error === null) return null
  const candidate = error as Record<string, unknown>
  if (typeof candidate.code !== 'string' || !candidate.code.startsWith('P')) return null
  return { code: candidate.code, meta: candidate.meta as Record<string, unknown> | undefined }
}

/**
 * Исходный код Postgres внутри ошибки Prisma. С адаптером драйвера он лежит
 * в `meta.driverAdapterError.cause.originalCode`, а сама ошибка приходит с кодом
 * Prisma, по которому причину не узнать (нарушение CHECK — P2039).
 */
function postgresCode(error: PrismaLikeError): string | null {
  const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: unknown } } | undefined
  const code = adapter?.cause?.originalCode
  return typeof code === 'string' ? code : null
}

/** Имя нарушенного ограничения из сообщения Postgres: «…violates check constraint "имя"». */
function constraintName(error: PrismaLikeError): string | null {
  const adapter = error.meta?.driverAdapterError as { cause?: { originalMessage?: unknown } } | undefined
  const message = adapter?.cause?.originalMessage
  if (typeof message !== 'string') return null
  return /constraint "([^"]+)"/.exec(message)?.[1] ?? null
}

function fromPrisma(error: PrismaLikeError): AppError | null {
  // Нарушение CHECK-ограничения базы: данные не прошли её правило. Это ошибка
  // ввода (422), а не сбой (500). Наружу — только имя ограничения: в тексте
  // Postgres есть «Failing row contains (…)», то есть вся строка с данными.
  if (error.code === 'P2004' || postgresCode(error) === '23514') {
    const constraint = constraintName(error)
    return new AppError(
      'VALIDATION_ERROR',
      'Значение не прошло проверку базы данных',
      constraint ? { constraint } : undefined,
    )
  }
  switch (error.code) {
    case 'P2002': {
      const target = error.meta?.target
      const fields = Array.isArray(target) ? target.join(', ') : String(target ?? '')
      return new AppError(
        'CONFLICT',
        fields ? `Запись с такими значениями уже существует: ${fields}` : 'Запись уже существует',
      )
    }
    case 'P2003':
      return new AppError('VALIDATION_ERROR', 'Ссылка на несуществующую связанную запись')
    case 'P2025':
      return new AppError('NOT_FOUND', 'Запись не найдена')
    default:
      return null
  }
}

/**
 * Ошибка в том виде, в каком её можно показать клиенту: ошибки приложения,
 * валидации и известные ошибки базы. `null` — внутренняя ошибка, её подробности
 * наружу не уходят.
 *
 * Одна функция на всех, кто отдаёт ошибку наружу: обработчик маршрута и импорт,
 * который сообщает об ошибке по каждой строке файла отдельно.
 */
export function toAppError(error: unknown): AppError | null {
  if (error instanceof AppError) return error
  if (error instanceof z.ZodError) return fromZod(error)
  const prismaError = asPrismaError(error)
  return prismaError ? fromPrisma(prismaError) : null
}

/**
 * Параметры пути. Идентификатор с символом кода 0 существовать не может —
 * это «не найдено», а не запрос к базе, которая такой символ не примет.
 */
async function rejectUnstorableParams(context: unknown): Promise<void> {
  if (typeof context !== 'object' || context === null || !('params' in context)) return
  const params: unknown = await (context as { params: unknown }).params
  if (findNul(params) !== null) throw notFound()
}

/**
 * Единая обёртка обработчика маршрута: ловит всё и отдаёт ответ в формате контракта.
 * Изменяющие запросы с чужим `Origin` отклоняет (origin.ts).
 * Никакие подробности внутренней ошибки наружу не уходят — ни клиенту, ни в журнал
 * вместе с данными запроса (shared/log, решение 123).
 *
 * Номер запроса (`x-request-id`, его ставит middleware; нет — выдаётся здесь) виден
 * журналу на всю глубину вызова и уходит в заголовок ответа; ответ 500 несёт его
 * и в теле — человек называет номер, по нему находится строка журнала.
 */
export function handle<Ctx>(
  fn: (request: Request, context: Ctx) => Promise<Response>,
): (request: Request, context: Ctx) => Promise<Response> {
  return async (request, context) => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER))
    const response = await runWithRequestId(requestId, async () => {
      try {
        // Изменяющий запрос со страницы чужого сайта отклоняется до всего остального.
        assertSameOrigin(request)
        await rejectUnstorableParams(context)
        return await fn(request, context)
      } catch (error) {
        const known = toAppError(error)
        if (known) return fail(known)

        log.error('Внутренняя ошибка сервера', {
          err: error,
          method: request.method,
          path: safePath(request.url),
        })
        return internalError(requestId)
      }
    })
    trySetHeader(response, REQUEST_ID_HEADER, requestId)
    return response
  }
}

/** Ответ 500: без подробностей, но с номером запроса для обращения в поддержку. */
export function internalError(requestId: string): Response {
  const response = fail(new AppError('INTERNAL', 'Внутренняя ошибка сервера'))
  return new Response(
    JSON.stringify({
      error: {
        code: 'INTERNAL',
        message: 'Внутренняя ошибка сервера',
        requestId,
      },
    }),
    { status: response.status, headers: response.headers },
  )
}

/** Путь без строки запроса: в параметрах бывают поисковые строки с ФИО. */
function safePath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return ''
  }
}

/** Заголовки ответа `Response.redirect` и некоторых готовых ответов неизменяемы. */
function trySetHeader(response: Response, name: string, value: string): void {
  try {
    response.headers.set(name, value)
  } catch {
    // Неизменяемые заголовки: номер останется только в журнале.
  }
}
