import { z } from '@/shared/zod'
import { AppError, fromZod } from './errors'
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
 * Единая обёртка обработчика маршрута: ловит всё и отдаёт ответ в формате контракта.
 * Никакие подробности внутренней ошибки наружу не уходят.
 */
export function handle<Ctx>(
  fn: (request: Request, context: Ctx) => Promise<Response>,
): (request: Request, context: Ctx) => Promise<Response> {
  return async (request, context) => {
    try {
      return await fn(request, context)
    } catch (error) {
      if (error instanceof AppError) return fail(error)
      if (error instanceof z.ZodError) return fail(fromZod(error))

      const prismaError = asPrismaError(error)
      if (prismaError) {
        const mapped = fromPrisma(prismaError)
        if (mapped) return fail(mapped)
      }

      // Персональные данные в лог не пишем — только тип и сообщение ошибки.
      console.error('[INTERNAL]', error instanceof Error ? error.message : error)
      return fail(new AppError('INTERNAL', 'Внутренняя ошибка сервера'))
    }
  }
}
