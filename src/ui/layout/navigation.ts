import type { CurrentUserDto } from '@/shared/contracts'
import type { IconName } from '../primitives/Icon'
import { API_CONTRACT_URL, ROUTES } from '../lib/links'

/**
 * Состав бокового меню.
 *
 * Две группы из дизайн-системы — «Рабочее пространство» и «Инструменты»
 * (раздел 4 шаблона страниц). Пункт появляется только тогда, когда роль
 * действительно может им пользоваться: показывать раздел, который ответит 403,
 * хуже, чем не показывать вовсе.
 */
export interface NavItem {
  href: string
  label: string
  icon: IconName
  /** Совпадение по началу пути: /universities/<id> подсвечивает «Университеты». */
  match?: string
}

export interface NavGroup {
  key: string
  title: string
  items: NavItem[]
}

export function navigationFor(user: CurrentUserDto): NavGroup[] {
  // У представителя вуза свой кабинет: внутренние реестры и аналитика ему закрыты.
  if (user.role === 'UNIVERSITY_REP') {
    return [
      {
        key: 'workspace',
        title: 'Рабочее пространство',
        items: [
          { href: ROUTES.portal, label: 'Мой вуз', icon: 'university' },
          { href: ROUTES.profile, label: 'Личный кабинет', icon: 'user' },
        ],
      },
    ]
  }

  const workspace: NavItem[] = [
    { href: ROUTES.dashboard, label: 'Главная', icon: 'home' },
    { href: ROUTES.universities, label: 'Вузы', icon: 'university' },
    { href: ROUTES.programs, label: 'Программы', icon: 'program' },
    { href: ROUTES.recommendations, label: 'Рекомендации', icon: 'recommendation' },
    { href: ROUTES.cooperations, label: 'Связки', icon: 'cooperation' },
  ]

  const tools: NavItem[] = []
  if (user.permissions.canSeeAnalytics) {
    tools.push({ href: ROUTES.analytics, label: 'Аналитика', icon: 'analytics' })
    tools.push({ href: ROUTES.dataQuality, label: 'Качество данных', icon: 'check' })
  }
  // Отчёт руководителю, отчёт и каталог по ТЗ живут под одним общим адресом
  // (решение 150) — пункт меню ведёт на раздел, подсвечивается на любой его странице.
  tools.push({ href: ROUTES.reports, label: 'Отчёты', icon: 'report' })
  tools.push({ href: ROUTES.documents, label: 'Документы', icon: 'document' })
  tools.push({ href: ROUTES.products, label: 'IT-продукты', icon: 'product' })
  // Вендоры — то же право, что у аналитики (VENDORS = ANALYTICS по составу ролей).
  if (user.permissions.canSeeAnalytics) {
    tools.push({ href: ROUTES.vendors, label: 'Вендоры', icon: 'building' })
  }
  tools.push({ href: ROUTES.settings, label: 'Настройки', icon: 'settings' })

  return [
    { key: 'workspace', title: 'Рабочее пространство', items: workspace },
    { key: 'tools', title: 'Инструменты', items: tools },
  ]
}

export interface ServiceLink {
  href: string
  label: string
  /** Открывается отдельной вкладкой: это ответ API, а не страница приложения. */
  external?: boolean
}

/**
 * Служебные ссылки подвала — по тем же правам, что и меню. Раньше подвал
 * держал свою копию меню без учёта роли и показывал представителю вуза
 * аналитику, рекомендации и настройки, которые ему закрыты.
 */
export function serviceLinksFor(user: CurrentUserDto): ServiceLink[] {
  const links: ServiceLink[] = [
    // Не сырой JSON: контракт — документом в новой вкладке, состояние — страницей
    // внутри приложения (решение 126).
    { href: API_CONTRACT_URL, label: 'Контракт API', external: true },
    { href: ROUTES.help, label: 'Справка' },
    { href: ROUTES.status, label: 'Состояние системы' },
  ]
  if (user.role !== 'UNIVERSITY_REP') {
    links.push({ href: `${ROUTES.settings}#integrations`, label: 'Источники данных' })
  }
  // Политика обработки ПД — всем ролям: её обязан видеть каждый, чьи данные в системе.
  links.push({ href: ROUTES.privacy, label: 'Персональные данные' })
  return links
}

/** Активен ли пункт для текущего адреса. */
export function isActiveItem(item: NavItem, pathname: string): boolean {
  const base = item.match ?? item.href
  if (base === ROUTES.dashboard) return pathname === ROUTES.dashboard
  return pathname === base || pathname.startsWith(`${base}/`)
}

/** Название текущего раздела — показывается в шапке рядом с логотипом. */
export function currentSectionTitle(groups: NavGroup[], pathname: string): string | null {
  for (const group of groups) {
    for (const item of group.items) {
      if (isActiveItem(item, pathname)) return item.label
    }
  }
  return null
}

/**
 * Охранник по маршруту (пробел ТЗ «раздел недоступен», решение 153): один общий
 * список вместо проверки в каждой странице отдельно — вписан здесь, рядом
 * с `navigationFor`, у которой те же правила для меню.
 *
 * По прямой ссылке на раздел, которого нет в навигации роли (например,
 * представитель вуза открывает `/universities`, `/analytics` или `/settings`),
 * `AppShell` показывает «Раздел недоступен» вместо содержимого страницы —
 * страница со своими запросами к API вообще не монтируется, и пустого экрана
 * или сырого 403 от API не возникает.
 *
 * Условие — не «есть в списке навигации»: `/portal` не входит в меню сотрудника
 * (кабинет вуза открывают ссылкой с карточки вуза, а не пунктом меню), но
 * `ADMIN`/`MANAGER`/`HEAD` должны его открывать, а `ANALYST`/`VIEWER` — нет,
 * то есть точно по `permissions.canUsePortal`, а не по составу меню.
 *
 * Эксперту (`isReviewer`) ничего не закрывается сверх обычных прав его роли:
 * права `/api/me` у эксперта уже учитывают его ограничения (решение 147, 152) —
 * читать он может то же, что и обычная учётная запись той же роли, отдельная
 * проверка `isReviewer` здесь не нужна.
 */
const SECTION_GUARDS: ReadonlyArray<{ prefix: string; allowed: (user: CurrentUserDto) => boolean }> = [
  { prefix: ROUTES.universities, allowed: (user) => user.role !== 'UNIVERSITY_REP' },
  { prefix: ROUTES.programs, allowed: (user) => user.role !== 'UNIVERSITY_REP' },
  { prefix: ROUTES.cooperations, allowed: (user) => user.role !== 'UNIVERSITY_REP' },
  { prefix: ROUTES.recommendations, allowed: (user) => user.role !== 'UNIVERSITY_REP' },
  { prefix: ROUTES.documents, allowed: (user) => user.role !== 'UNIVERSITY_REP' },
  { prefix: ROUTES.products, allowed: (user) => user.role !== 'UNIVERSITY_REP' },
  { prefix: ROUTES.settings, allowed: (user) => user.role !== 'UNIVERSITY_REP' },
  { prefix: ROUTES.reports, allowed: (user) => user.role !== 'UNIVERSITY_REP' },
  { prefix: ROUTES.analytics, allowed: (user) => user.permissions.canSeeAnalytics },
  { prefix: ROUTES.dataQuality, allowed: (user) => user.permissions.canSeeAnalytics },
  { prefix: ROUTES.vendors, allowed: (user) => user.permissions.canSeeAnalytics },
  { prefix: ROUTES.portal, allowed: (user) => user.permissions.canUsePortal },
]

/**
 * Пути, открытые любой роли независимо от `SECTION_GUARDS`: личный кабинет
 * (не в меню сотрудника, но доступен всем через шапку), справка (решение 154),
 * служебные страницы подвала (`serviceLinksFor` — они и представителю вуза открыты) и сама
 * главная (`/`): у неё свой редирект на `/portal` для представителя вуза
 * внутри страницы (`page.tsx`), который должен успеть отработать, а не быть
 * перехваченным охранником раньше.
 */
const ALWAYS_ALLOWED_PATHS: ReadonlySet<string> = new Set([
  ROUTES.dashboard,
  ROUTES.profile,
  ROUTES.privacy,
  ROUTES.status,
  ROUTES.help,
])

/** Доступен ли пользователю раздел по адресу `pathname` — без учёта хвоста после `?`/`#`. */
export function isSectionAllowed(user: CurrentUserDto, pathname: string): boolean {
  if (ALWAYS_ALLOWED_PATHS.has(pathname)) return true
  const guard = SECTION_GUARDS.find(
    (item) => pathname === item.prefix || pathname.startsWith(`${item.prefix}/`),
  )
  return guard ? guard.allowed(user) : true
}
