import { forbidden } from './errors'

/**
 * Защита изменяющих запросов от чужих сайтов (CSRF).
 *
 * Cookie сессии выставляется с `SameSite=Lax`, и браузер не отправит её при
 * межсайтовом POST — но это одна линия обороны, и она держится на браузере.
 * Вторая: браузер сам подписывает запрос заголовком `Origin`, и подделать его
 * со страницы другого сайта нельзя. Запрос, изменяющий данные, принимается,
 * только если `Origin` — наш сайт: адрес из `AUTH_URL` или тот же хост, на
 * который пришёл запрос.
 *
 * Запрос без `Origin` пропускается: так ходят не браузеры, а скрипты — smoke,
 * пробник, сверка стенда, curl. Им подделывать нечего: cookie чужого
 * пользователя у них нет. Маршруты `/api/auth/*` сюда не попадают — у NextAuth
 * своя защита токеном.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export interface OriginCheck {
  method: string
  /** Заголовок Origin; null — его нет. */
  origin: string | null
  /** Хост, на который пришёл запрос (заголовок Host или X-Forwarded-Host). */
  hosts: ReadonlyArray<string | null>
  /** Адрес сайта из AUTH_URL, если задан. */
  siteUrl: string | undefined
}

function originOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function isAllowedOrigin(check: OriginCheck): boolean {
  if (SAFE_METHODS.has(check.method.toUpperCase())) return true
  if (check.origin === null) return true

  // «null» — непрозрачный источник: песочница iframe, data:-страница. Не наш сайт.
  const origin = originOf(check.origin)
  if (origin === null) return false

  if (origin === originOf(check.siteUrl)) return true

  const host = new URL(origin).host
  return check.hosts.some((candidate) => candidate !== null && candidate.trim().toLowerCase() === host)
}

export function assertSameOrigin(request: Request): void {
  const allowed = isAllowedOrigin({
    method: request.method,
    origin: request.headers.get('origin'),
    hosts: [request.headers.get('x-forwarded-host'), request.headers.get('host')],
    siteUrl: process.env.AUTH_URL,
  })
  if (!allowed) throw forbidden('Запрос пришёл с другого сайта и отклонён')
}
