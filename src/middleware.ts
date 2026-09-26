import { NextResponse, type NextRequest } from 'next/server'
import { REAUTH_PARAM } from '@/shared/auth/reauth'
import { NONCE_HEADER, buildContentSecurityPolicy, createNonce } from '@/shared/http/csp'
import { REQUEST_ID_HEADER, resolveRequestId } from '@/shared/http/request-id'

/**
 * Неавторизованного посетителя страницы отправляют на вход.
 *
 * Здесь проверяется только наличие куки сессии, а не её подпись: middleware
 * выполняется в edge-среде, куда не тянутся ни bcrypt, ни Prisma, и попытка
 * проверить токен целиком стоила бы отдельной сборки конфигурации входа.
 *
 * Это не дыра: страницы данных не содержат — всё приходит запросами к API,
 * а там каждый маршрут проверяет сессию и права по-настоящему. Подделанная
 * или устаревшая кука откроет пустой каркас, который получит 401, снимет
 * сессию и уйдёт на вход с `reauth=1`.
 */
const SESSION_COOKIES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  // Имена из предыдущего поколения библиотеки: встречаются после обновления.
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
]

const PUBLIC_PATHS = ['/login']

/**
 * Открыты всем — и с сессией, и без: политика обработки персональных данных
 * (её оператор обязан опубликовать — ч. 2 ст. 18.1 152-ФЗ, и прочитать её должен
 * и тот, кто ещё не вошёл). Данных системы не содержит, в API не ходит. Манифест
 * со значками браузер запрашивает без входа — иначе получал бы перенаправление
 * на страницу входа.
 *
 * `/presentation` здесь не было смысла держать: страницы и файлов `public/presentation/`
 * нет — вход отдавал бы всем без исключения 404 на публичном пути (риск 13 ревизии
 * от 26.09.2026). Появится страница презентации — путь возвращается сюда.
 */
const OPEN_PATHS = ['/privacy', '/manifest.webmanifest']

function matches(paths: readonly string[], pathname: string): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

/**
 * Пропустить запрос дальше с Content-Security-Policy на свой nonce (решение 112).
 *
 * Политика уходит дважды: в ответ — браузеру, и в заголовки запроса — Next,
 * который берёт из неё nonce для своих скриптов. `x-nonce` читает корневой
 * макет для встроенных скриптов. Пришедшие от клиента одноимённые заголовки
 * перезаписываются: nonce задаёт только сервер.
 */
function pass(request: NextRequest, requestId: string): NextResponse {
  const nonce = createNonce()
  const policy = buildContentSecurityPolicy({
    nonce,
    dev: process.env.NODE_ENV !== 'production',
    // За Caddy приложение слушает http, протокол посетителя — в X-Forwarded-Proto
    // (Caddy выставляет его сам, присланный клиентом не пропускает).
    https: request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https',
  })
  const headers = new Headers(request.headers)
  headers.set(NONCE_HEADER, nonce)
  headers.set('content-security-policy', policy)
  headers.set(REQUEST_ID_HEADER, requestId)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set('content-security-policy', policy)
  response.headers.set(REQUEST_ID_HEADER, requestId)
  return response
}

/**
 * Запрос к API: только номер запроса (решение 133). Ни перенаправления на вход
 * (API отвечает 401 сам), ни политики с nonce (у ответов API — общая часть
 * из next.config.ts). Присланный номер принимается, если он допустим, иначе
 * выдаётся свой — одинаково в запрос к обработчику и в ответ.
 */
function passApi(request: NextRequest, requestId: string): NextResponse {
  const headers = new Headers(request.headers)
  headers.set(REQUEST_ID_HEADER, requestId)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set(REQUEST_ID_HEADER, requestId)
  return response
}

function isApi(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER))

  if (isApi(pathname)) return passApi(request, requestId)
  if (matches(OPEN_PATHS, pathname)) return pass(request, requestId)

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name))
  const isPublic = matches(PUBLIC_PATHS, pathname)

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // Куда пользователь шёл: после входа возвращаем именно туда.
    url.search = pathname === '/' ? '' : `?from=${encodeURIComponent(pathname + search)}`
    return withRequestId(NextResponse.redirect(url), requestId)
  }

  // Вошедшему на странице входа делать нечего — если только сервер его сессию
  // не отверг: тогда приложение само ведёт сюда с `reauth=1` (src/ui/lib/session.ts).
  // Без этого исключения вход возвращал на главную, главная — снова на вход,
  // и экран оставался пустым, пока не почистишь cookie.
  if (hasSession && isPublic && !request.nextUrl.searchParams.has(REAUTH_PARAM)) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return withRequestId(NextResponse.redirect(url), requestId)
  }

  return pass(request, requestId)
}

function withRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set(REQUEST_ID_HEADER, requestId)
  return response
}

export const config = {
  /**
   * Маршруты API сюда попадают только ради номера запроса (решение 133): они отвечают
   * кодом 401, а не перенаправлением — редирект на HTML-страницу входа сломал бы
   * любой запрос из интерфейса (`passApi`). Статика и служебные файлы исключены.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
