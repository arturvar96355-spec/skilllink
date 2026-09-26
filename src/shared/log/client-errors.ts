/**
 * Приём ошибок фронтенда (решение 123): `POST /api/client-errors` без входа.
 *
 * Страница, упавшая у пользователя, присылает сообщение и стек — сервер пишет их
 * в общий журнал с меткой `client-error` и номером запроса. Ответ всегда 204:
 * ни подсказок атакующему, ни повторов из-за «ошибки приёма ошибки».
 *
 * Защита от засорения журнала — здесь же, без общего ограничителя частоты:
 * тело не больше 8 КБ, известные поля обрезаются, остальные отбрасываются,
 * с одного адреса — не больше N сообщений в минуту (память процесса).
 */

export const CLIENT_ERRORS = {
  maxBodyBytes: 8 * 1024,
  /** Сообщений с одного адреса в окне. */
  perAddress: 30,
  windowMs: 60_000,
  /** Адресов в памяти — больше не держим, самые старые забываются. */
  maxAddresses: 5000,
  fieldLimits: {
    message: 1000,
    stack: 4000,
    url: 500,
    component: 200,
    digest: 100,
    level: 20,
    release: 100,
  },
} as const

type Field = keyof typeof CLIENT_ERRORS.fieldLimits

/** Известные поля, строки, обрезанные по пределу. Остальное отбрасывается. */
export function sanitizeClientError(raw: unknown): Partial<Record<Field, string>> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const result: Partial<Record<Field, string>> = {}
  for (const [field, limit] of Object.entries(CLIENT_ERRORS.fieldLimits) as Array<[Field, number]>) {
    const value = (raw as Record<string, unknown>)[field]
    if (typeof value !== 'string' || value.trim() === '') continue
    result[field] = value.length > limit ? `${value.slice(0, limit)}…` : value
  }
  return result.message || result.stack ? result : null
}

/** Адрес страницы без строки запроса и якоря: в них бывают поисковые строки с ФИО. */
export function stripQuery(url: string | undefined): string | undefined {
  if (!url) return undefined
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

interface Window {
  startedAt: number
  count: number
}

/** Скользящее окно на адрес. Отдельный экземпляр — для тестов. */
export class ClientErrorLimiter {
  private readonly windows = new Map<string, Window>()

  constructor(
    private readonly limits: { perAddress: number; windowMs: number; maxAddresses: number } = CLIENT_ERRORS,
  ) {}

  /** true — сообщение принять, false — адрес исчерпал окно. */
  allow(address: string, now = Date.now()): boolean {
    const current = this.windows.get(address)
    if (!current || now - current.startedAt >= this.limits.windowMs) {
      if (!current && this.windows.size >= this.limits.maxAddresses) {
        const oldest = this.windows.keys().next().value
        if (oldest !== undefined) this.windows.delete(oldest)
      }
      this.windows.delete(address)
      this.windows.set(address, { startedAt: now, count: 1 })
      return true
    }
    current.count += 1
    return current.count <= this.limits.perAddress
  }
}
