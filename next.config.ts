import type { NextConfig } from 'next'

/**
 * Защитные заголовки ответа.
 *
 * Дешёвая часть защиты, которую нельзя добавить «потом»: браузер полагается на них
 * при каждом ответе, и их отсутствие не видно ни в одном тесте функциональности.
 *
 * Content-Security-Policy здесь — только директивы, не касающиеся скриптов: она
 * остаётся на ответах API, файлах сборки и значках. Страницы получают полную
 * политику с nonce из middleware (src/shared/http/csp.ts, решение 112) — nonce
 * у каждого запроса свой, статичным заголовком его не задать. Заголовок
 * middleware заменяет этот: у страницы в ответе одна политика, полная.
 */
const SECURITY_HEADERS = [
  // Не угадывать тип содержимого: загруженный текст не должен исполниться как скрипт.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Приложение не предназначено для встраивания в чужие страницы (защита от кликджекинга).
  { key: 'X-Frame-Options', value: 'DENY' },
  // Адреса внутренних страниц не утекают на сторонние сайты в заголовке Referer:
  // в них бывают идентификаторы вузов и связок.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Возможности браузера, которые системе не нужны, отключены явно.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // Межсайтовые окна и документы не получают ссылку на наше окно.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // HSTS: браузер сам поднимает следующий заход на https, даже если ссылка или
  // старая закладка была на http. Уже стоит в `deploy/yandex-cloud/Caddyfile` —
  // здесь дублируется намеренно (решение 173): другой reverse proxy или локальный
  // https без Caddy иначе тихо остались бы без заголовка. По обычному http браузер
  // этот заголовок просто игнорирует (RFC 6797, п. 7.2) — локальной разработке
  // (`npm run dev` без TLS) он не мешает.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  // Часть CSP для всего, что не страница: не встраиваться в чужие страницы (то же, что
  // X-Frame-Options, но для современных браузеров), не грузить плагины через
  // <object>, не подменять базовый адрес ссылок и не отправлять формы на чужой сайт.
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
]

const nextConfig: NextConfig = {
  // Заголовок X-Powered-By: Next.js сообщает любому, на чём собран сайт, — подсказка
  // для подбора известных уязвимостей и больше ни для чего.
  poweredByHeader: false,
  // standalone-сборка кладёт в .next/standalone сервер со всеми нужными зависимостями:
  // образу не нужен весь node_modules, и он получается в разы меньше.
  output: 'standalone',
  // Prisma и драйвер Postgres не бандлятся: работают как обычные node-модули на сервере.
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg'],
  typescript: { ignoreBuildErrors: false },
  // Линтер — отдельный шаг CI (`npm run lint`, eslint.config.mjs), а не часть сборки:
  // образ на сервере собирается без повторного прогона, и сборка не зависит от линтера.
  eslint: { ignoreDuringBuilds: true },

  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      /**
       * Страницы не показываются из кэша браузера без проверки у сервера.
       *
       * Готовые страницы Next отдаёт с `s-maxage`, рассчитанным на промежуточные
       * кэши. Браузер, не найдя `max-age`, выбирает срок сам — и после выкладки
       * показывает старую версию. `no-cache` требует спросить сервер; при
       * совпадении ETag ответ будет пустым 304.
       *
       * Файлы сборки под `/_next/static` сюда не попадают: у них хеш в имени,
       * и их кэшируют надолго (правило в Caddyfile стенда).
       */
      {
        source: '/((?!_next/static|_next/image).*)',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
      /**
       * Ответы о пользователях не хранятся ни в каком кэше: в ответе на заведение
       * и на выдачу пароля — одноразовый временный пароль, в списке — рабочие адреса.
       * Правило стоит после общего и заменяет его `no-cache` (из двух правил
       * с одним заголовком Next берёт последнее); заголовок, выставленный
       * в самом маршруте, общее правило перекрывало.
       */
      {
        source: '/api/users/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      /**
       * Календарь (решение 105): в ответе на выпуск — ссылка-доступ, лента — личная.
       * Ни браузер, ни прокси не должны хранить ни то, ни другое: после отзыва
       * ссылки лента из кэша выдала бы то, что владелец уже закрыл.
       */
      {
        source: '/api/me/calendar',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/api/calendar/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      /**
       * Загрузки (решение 132): файл «Загрузка пользователей» для LMS — это ФИО,
       * телефоны и почты слушателей, предпросмотр вендоров — их контакты. Карточка
       * вендора — рабочие почты и телефоны. Ни браузер, ни прокси их не хранят.
       * Заголовок в самом маршруте общее правило перекрыло бы (см. выше).
       */
      {
        source: '/api/import/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/api/vendors/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      /**
       * «Всё о субъекте» и реестр запросов субъектов ПД (решение 116): в выгрузке все
       * ПД человека. Маршрут выгрузки ставит no-store сам, но общее правило выше его
       * перекрыло бы — поэтому и здесь.
       */
      {
        source: '/api/admin/dsar/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/api/me/data-export',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      /** Задача проверки «не робот» у каждого запроса своя — хранить её нечего и незачем. */
      {
        source: '/api/login-challenge',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]
  },
}

export default nextConfig
