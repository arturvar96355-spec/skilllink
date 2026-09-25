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
    { href: ROUTES.universities, label: 'Университеты', icon: 'university' },
    { href: ROUTES.programs, label: 'Программы', icon: 'program' },
    { href: ROUTES.recommendations, label: 'Рекомендации', icon: 'recommendation' },
    { href: ROUTES.cooperations, label: 'Сотрудничество', icon: 'cooperation' },
  ]

  const tools: NavItem[] = []
  if (user.permissions.canSeeAnalytics) {
    tools.push({ href: ROUTES.analytics, label: 'Аналитика', icon: 'analytics' })
  }
  tools.push({ href: ROUTES.documents, label: 'Документы', icon: 'document' })
  tools.push({ href: ROUTES.products, label: 'IT-продукты', icon: 'product' })
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
    // внутри приложения (решение 107).
    { href: API_CONTRACT_URL, label: 'Контракт API', external: true },
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
