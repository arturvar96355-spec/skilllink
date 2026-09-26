import type { NotificationTargetDto, RecommendationTargetDto, SearchEntityType } from '@/shared/contracts'

/**
 * Адреса страниц объектов.
 *
 * Собраны в одном месте намеренно: на объект ведут поиск, лента уведомлений,
 * рекомендации и обычные списки. Когда маршрут строится в каждом из них
 * отдельно, после переименования страницы часть ссылок молча ведёт на 404 —
 * и заметно это только на показе.
 */

export const ROUTES = {
  dashboard: '/',
  universities: '/universities',
  programs: '/programs',
  cooperations: '/cooperations',
  recommendations: '/recommendations',
  analytics: '/analytics',
  documents: '/documents',
  products: '/products',
  settings: '/settings',
  profile: '/profile',
  portal: '/portal',
  /** Раздел отчётов: отчёт руководителю, отчёт и каталог по ТЗ (решение 150). */
  reports: '/reports',
  /** Отчёт руководителю: лист A4 для печати и PDF (решение 97). */
  managerReport: '/reports/portfolio',
  /** Отчёт по ТЗ РТК: пять колонок дословно по заданию (решение 150). */
  tzReport: '/reports/tz',
  /** Каталог по ТЗ РТК: реквизиты лицензии и передачи ПО (решение 150). */
  catalogReport: '/reports/catalog',
  login: '/login',
  /** Политика обработки персональных данных — открыта без входа. */
  privacy: '/privacy',
  /** Состояние системы словами — вместо сырого JSON /api/health (решение 126). */
  status: '/status',
  /** Качество данных: пробелы, устаревшее, дубли (ТЗ дизайна 26–29.09, п. 4.4). */
  dataQuality: '/data-quality',
} as const

/**
 * Контракт API — документ в репозитории (он публичный): человек видит оформленный
 * текст, а не сырой /api/openapi.json, который выглядел как «сайт сломался».
 */
export const API_CONTRACT_URL = 'https://github.com/arturvar96355-spec/skilllink/blob/main/docs/API_CONTRACT.md'

export function universityHref(id: string): string {
  return `${ROUTES.universities}/${id}`
}

export function programHref(id: string): string {
  return `${ROUTES.programs}/${id}`
}

export function cooperationHref(id: string, stageId?: string | null): string {
  return stageId ? `${ROUTES.cooperations}/${id}?stage=${stageId}` : `${ROUTES.cooperations}/${id}`
}

export function documentHref(id: string): string {
  return `${ROUTES.documents}?document=${id}`
}

export function recommendationHref(id: string): string {
  return `${ROUTES.recommendations}?recommendation=${id}`
}

export function productHref(id: string): string {
  return `${ROUTES.products}?product=${id}`
}

export function skillHref(id: string): string {
  return `${ROUTES.analytics}?tab=skills&skill=${id}`
}

/** Результат глобального поиска ведёт на страницу своего объекта. */
export function searchItemHref(type: SearchEntityType, id: string): string {
  switch (type) {
    case 'university':
      return universityHref(id)
    case 'program':
      return programHref(id)
    case 'cooperation':
      return cooperationHref(id)
    case 'product':
      return productHref(id)
    case 'skill':
      return skillHref(id)
    case 'document':
      return documentHref(id)
  }
}

/**
 * Уведомление ведёт туда, к чему относится, а не на главную (раздел 17.1
 * дизайн-системы). Для этапа связки — сразу к нужному этапу.
 */
export function notificationHref(target: NotificationTargetDto): string {
  switch (target.type) {
    case 'cooperation':
      return cooperationHref(target.cooperationId ?? target.id, target.stageId)
    case 'document':
      return documentHref(target.id)
    case 'recommendation':
      return recommendationHref(target.id)
    case 'university':
      return universityHref(target.id)
  }
}

/** Рекомендация ссылается на объект, из-за которого она появилась. */
export function recommendationTargetHref(target: RecommendationTargetDto): string {
  switch (target.objectType) {
    case 'Cooperation':
      return cooperationHref(target.objectId)
    case 'EducationalProgram':
      return programHref(target.objectId)
    case 'University':
      return universityHref(target.objectId)
    case 'Skill':
      return skillHref(target.objectId)
  }
}
