/**
 * Шаблон маршрута API для метки `route` (решение 137).
 *
 * В метке — шаблон (`/api/universities/[id]`), а не фактический адрес: каждый
 * id записи иначе стал бы отдельным рядом метрики, и тысяча открытых карточек
 * дала бы тысячу рядов в памяти процесса и в базе Prometheus. По той же
 * причине всё, что не совпало ни с одним маршрутом (опечатки, перебор адресов
 * вроде `/api/wp-admin`), — одна метка `other`.
 *
 * Список ведётся руками: у обработчика маршрута Next нет способа узнать свой
 * шаблон. Полноту сторожит routes.test.ts — он сверяет список с файлами
 * `src/app/api/**\/route.ts` и падает, если маршрут добавлен, а сюда — нет.
 */

/** Метка для адреса, которого нет среди маршрутов. */
export const OTHER_ROUTE = 'other'

/** Перехватывающий маршрут «нет такого адреса» — это и есть `other`. */
const UNKNOWN_CATCH_ALL = '/api/[...unknown]'

export const API_ROUTE_TEMPLATES: readonly string[] = [
  '/api/[...unknown]',
  '/api/admin/approvals',
  '/api/admin/approvals/[id]/approve',
  '/api/admin/approvals/[id]/reject',
  '/api/admin/audit/export',
  '/api/admin/dsar/contacts/[id]/erase',
  '/api/admin/dsar/contacts/[id]/export',
  '/api/admin/dsar/requests',
  '/api/admin/dsar/users/[id]/erase',
  '/api/admin/dsar/users/[id]/export',
  '/api/admin/telegram/rotate-webhook-secret',
  '/api/ai/today',
  '/api/analytics/cohorts',
  '/api/analytics/funnel',
  '/api/analytics/insights',
  '/api/analytics/meetings-heatmap',
  '/api/analytics/overview',
  '/api/analytics/programs',
  '/api/analytics/stage-durations',
  '/api/analytics/stalled-preview',
  '/api/audit',
  '/api/audit/seals',
  '/api/audit/verify',
  '/api/auth/[...nextauth]',
  '/api/calendar/[feed]',
  '/api/client-errors',
  '/api/contacts/[id]/reveal',
  '/api/cooperations',
  '/api/cooperations/[id]',
  '/api/cooperations/[id]/ai-summary',
  '/api/cooperations/[id]/blockers',
  '/api/cooperations/[id]/documents/generate',
  '/api/cooperations/[id]/proposals',
  '/api/cooperations/[id]/proposals/[proposalId]/apply',
  '/api/cooperations/[id]/stages',
  '/api/cooperations/[id]/story',
  '/api/data-quality/duplicates',
  '/api/data-quality/duplicates/dismiss',
  '/api/data-quality/report',
  '/api/data-sources',
  '/api/data-sources/sync',
  '/api/document-templates',
  '/api/documents',
  '/api/documents/[id]',
  '/api/documents/[id]/status',
  '/api/documents/[id]/versions',
  '/api/export',
  '/api/health',
  '/api/import',
  '/api/import/site-orders',
  '/api/import/site-orders/lms-file',
  '/api/import/vendors',
  '/api/integrations/status',
  '/api/login-challenge',
  '/api/me',
  '/api/me/calendar',
  '/api/me/data-export',
  '/api/me/password',
  '/api/me/pulse',
  '/api/me/stats',
  '/api/me/telegram',
  '/api/meetings',
  '/api/meetings/[id]',
  '/api/metrics',
  '/api/notifications',
  '/api/openapi.json',
  '/api/portal/applications',
  '/api/portal/materials',
  '/api/portal/materials/[taskId]/confirm',
  '/api/portal/overview',
  '/api/portal/programs/[id]/metrics',
  '/api/products',
  '/api/products/[id]',
  '/api/products/[id]/release',
  '/api/products/[id]/skills',
  '/api/programs',
  '/api/programs/[id]',
  '/api/programs/[id]/archive',
  '/api/programs/[id]/restore',
  '/api/programs/[id]/similar',
  '/api/programs/[id]/skills',
  '/api/ready',
  '/api/recommendations',
  '/api/recommendations/[id]',
  '/api/recommendations/[id]/ai-letter',
  '/api/recommendations/experiment',
  '/api/recommendations/generate',
  '/api/recommendations/rules/stats',
  '/api/recommendations/why-not',
  '/api/school-courses',
  '/api/search',
  '/api/settings/parameters',
  '/api/skills',
  '/api/skills/[id]',
  '/api/skills/[id]/merge',
  '/api/skills/demand',
  '/api/skills/gaps',
  '/api/telegram/webhook',
  '/api/universities',
  '/api/universities/[id]',
  '/api/universities/[id]/archive',
  '/api/universities/[id]/contacts/[contactId]/anonymize',
  '/api/universities/[id]/contacts/[contactId]/consent/withdraw',
  '/api/universities/[id]/contacts/[contactId]/legal-basis',
  '/api/universities/[id]/contacts/[contactId]/legal-basis/history',
  '/api/universities/[id]/events',
  '/api/universities/[id]/restore',
  '/api/universities/[id]/story',
  '/api/universities/[id]/timeline',
  '/api/universities/merge',
  '/api/universities/merge/[id]/undo',
  '/api/users',
  '/api/users/[id]',
  '/api/users/[id]/password-reset',
  '/api/vendors',
  '/api/vendors/[id]',
  '/api/workflow/blocked',
  '/api/workflow/overdue',
  '/api/workflow/stages/[id]',
  '/api/workflow/stages/[id]/history',
  '/api/workflow/tasks/[id]',
]

type Segment = { kind: 'static'; text: string } | { kind: 'dynamic' } | { kind: 'catchAll' }

interface CompiledRoute {
  template: string
  segments: Segment[]
}

function compile(template: string): CompiledRoute {
  const segments = template
    .split('/')
    .filter(Boolean)
    .map((part): Segment => {
      if (/^\[\.\.\.[^\]]+\]$/.test(part)) return { kind: 'catchAll' }
      if (/^\[[^\]]+\]$/.test(part)) return { kind: 'dynamic' }
      return { kind: 'static', text: part }
    })
  return { template, segments }
}

const COMPILED = API_ROUTE_TEMPLATES.filter((template) => template !== UNKNOWN_CATCH_ALL).map(compile)

/**
 * Вес совпадения по сегментам, как выбирает Next: статический сегмент важнее
 * динамического, динамический — перехватывающего. `null` — не совпало.
 */
function matchRank(route: CompiledRoute, parts: readonly string[]): number[] | null {
  const rank: number[] = []
  for (let index = 0; index < route.segments.length; index += 1) {
    const segment = route.segments[index]!
    if (segment.kind === 'catchAll') {
      // `[...x]` требует хотя бы одного сегмента и забирает все оставшиеся.
      if (parts.length <= index) return null
      rank.push(2)
      return rank
    }
    const part = parts[index]
    if (part === undefined) return null
    if (segment.kind === 'static') {
      if (segment.text !== part) return null
      rank.push(0)
    } else {
      rank.push(1)
    }
  }
  return parts.length === route.segments.length ? rank : null
}

function better(candidate: number[], current: number[]): boolean {
  for (let index = 0; index < Math.min(candidate.length, current.length); index += 1) {
    if (candidate[index]! !== current[index]!) return candidate[index]! < current[index]!
  }
  return candidate.length > current.length
}

/** Шаблон маршрута для пути запроса; не совпало ни с одним — `other`. */
export function routeTemplate(pathname: string): string {
  let parts: string[]
  try {
    parts = pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
  } catch {
    return OTHER_ROUTE
  }
  let best: { template: string; rank: number[] } | null = null
  for (const route of COMPILED) {
    const rank = matchRank(route, parts)
    if (rank && (!best || better(rank, best.rank))) best = { template: route.template, rank }
  }
  return best?.template ?? OTHER_ROUTE
}
