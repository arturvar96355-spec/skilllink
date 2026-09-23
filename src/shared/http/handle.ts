import { z } from '@/shared/zod'
import { describeForLog } from '@/shared/db/log'
import { findNul } from '@/shared/db/storable'
import { AppError, fromZod, notFound } from './errors'
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

function fromPrisma(error: PrismaLikeError): AppError | null {
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
 * Никакие подробности внутренней ошибки наружу не уходят — ни клиенту, ни в журнал
 * вместе с данными запроса (shared/db/log.ts).
 */
export function handle<Ctx>(
  fn: (request: Request, context: Ctx) => Promise<Response>,
): (request: Request, context: Ctx) => Promise<Response> {
  return async (request, context) => {
    try {
      await rejectUnstorableParams(context)
      return await fn(request, context)
    } catch (error) {
      const known = toAppError(error)
      if (known) return fail(known)

      console.error('[INTERNAL]', describeForLog(error))
      return fail(new AppError('INTERNAL', 'Внутренняя ошибка сервера'))
    }
  }
}
