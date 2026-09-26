import { clientAddress } from '@/shared/auth/throttle'
import { assertSameOrigin } from '@/shared/http/origin'
import { readBodyBytes } from '@/shared/http/request'
import { REQUEST_ID_HEADER, resolveRequestId } from '@/shared/http/request-id'
import { validationError } from '@/shared/http/errors'
import { CLIENT_ERRORS, ClientErrorLimiter, sanitizeClientError, stripQuery } from '@/shared/log/client-errors'
import { log } from '@/shared/log/logger'
import { runWithRequestId } from '@/shared/log/request-context'

/**
 * Ошибки фронтенда в журнал сервера (решение 123). Без входа, ответ всегда 204.
 * Не через `handle()`: здесь нет ответов об ошибках — ни 403 чужому сайту,
 * ни 422 на кривое тело; неподходящее просто не пишется.
 */
export const dynamic = 'force-dynamic'

const limiter = new ClientErrorLimiter()

const noContent = (requestId: string) => new Response(null, { status: 204, headers: { [REQUEST_ID_HEADER]: requestId } })

export const POST = async (request: Request): Promise<Response> => {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER))
  return runWithRequestId(requestId, async () => {
    try {
      // Чужой сайт засорять наш журнал не должен (исключение — тот же ответ 204, запись не делается).
      assertSameOrigin(request)
      if (!limiter.allow(clientAddress(request.headers))) return noContent(requestId)

      const bytes = await readBodyBytes(request, CLIENT_ERRORS.maxBodyBytes, () => validationError('too large'))
      const report = sanitizeClientError(JSON.parse(new TextDecoder().decode(bytes)))
      if (!report) return noContent(requestId)

      log.warn('client-error', {
        kind: 'client-error',
        ...report,
        url: stripQuery(report.url),
        userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null,
      })
    } catch {
      // Слишком большое, не JSON, оборванное — не пишется, ответ тот же.
    }
    return noContent(requestId)
  })
}
