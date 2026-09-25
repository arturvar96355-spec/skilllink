import { NextResponse, type NextRequest } from 'next/server'
import { REAUTH_PARAM } from '@/shared/auth/reauth'

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
 * Открыты всем — и с сессией, и без: презентация проекта для защиты и её файлы
 * в `public/presentation/`, политика обработки персональных данных (её оператор
 * обязан опубликовать — ч. 2 ст. 18.1 152-ФЗ, и прочитать её должен и тот, кто
 * ещё не вошёл). Данных системы не содержат, в API не ходят. Манифест со значками
 * браузер запрашивает без входа — иначе получал бы перенаправление на страницу входа.
 */
const OPEN_PATHS = ['/presentation', '/privacy', '/manifest.webmanifest']

function matches(paths: readonly string[], pathname: string): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (matches(OPEN_PATHS, pathname)) return NextResponse.next()

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name))
  const isPublic = matches(PUBLIC_PATHS, pathname)

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // Куда пользователь шёл: после входа возвращаем именно туда.
    url.search = pathname === '/' ? '' : `?from=${encodeURIComponent(pathname + search)}`
    return NextResponse.redirect(url)
  }

  // Вошедшему на странице входа делать нечего — если только сервер его сессию
  // не отверг: тогда приложение само ведёт сюда с `reauth=1` (src/ui/lib/session.ts).
  // Без этого исключения вход возвращал на главную, главная — снова на вход,
  // и экран оставался пустым, пока не почистишь cookie.
  if (hasSession && isPublic && !request.nextUrl.searchParams.has(REAUTH_PARAM)) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  /**
   * Маршруты API сюда не попадают: они отвечают кодом 401, а не перенаправлением —
   * редирект на HTML-страницу входа сломал бы любой запрос из интерфейса.
   * Статика и служебные файлы тоже исключены.
   */
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
