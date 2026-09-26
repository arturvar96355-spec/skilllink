'use client'

import Link from 'next/link'
import {
  RECOMMENDATION_PRIORITY_LABELS,
  type RecommendationDto,
  type RecommendationPriority,
} from '@/shared/contracts'
import { Icon, OPEN_RECOMMENDATION_STATUSES, PriorityBadge, ROUTES, buildQuery, formatNumber, pluralize, useResource } from '@/ui'
import styles from './dashboard.module.css'

/** Число открытых рекомендаций одного приоритета — из `meta.total`, строки не нужны. */
function useOpenCount(priority: RecommendationPriority) {
  const resource = useResource<RecommendationDto[]>(
    `/api/recommendations${buildQuery({ status: OPEN_RECOMMENDATION_STATUSES, priority, pageSize: 1 })}`,
  )
  return { count: resource.meta?.total ?? null, error: resource.error }
}

/**
 * Открытые рекомендации по приоритету — под «Приоритетными действиями».
 *
 * Сервер отдаёт на главную пять самых важных рекомендаций, а «Требует внимания»
 * рядом — десять этапов: правая колонка обрывалась, под ней зияла пустота
 * (ТЗ дизайна 26–29.09, п. 1.2). Здесь — сколько всего открытого за этими пятью,
 * и каждая строка ведёт в ленту с уже выбранным приоритетом (п. 3.5).
 */
export function PriorityBreakdown() {
  // Сверху — самое важное, как в ленте «сначала важное». Хуки — по одному на
  // приоритет, в постоянном порядке.
  const critical = useOpenCount('CRITICAL')
  const high = useOpenCount('HIGH')
  const medium = useOpenCount('MEDIUM')
  const low = useOpenCount('LOW')
  const rows: { priority: RecommendationPriority; count: number | null; error: unknown }[] = [
    { priority: 'CRITICAL', ...critical },
    { priority: 'HIGH', ...high },
    { priority: 'MEDIUM', ...medium },
    { priority: 'LOW', ...low },
  ]

  // Не ответил хотя бы один запрос — блок не показываем: неполная сводка хуже никакой.
  if (rows.some((row) => row.error)) return null
  const loaded = rows.every((row) => row.count !== null)
  const total = loaded ? rows.reduce((sum, row) => sum + (row.count ?? 0), 0) : null

  return (
    <div className={styles.priorities}>
      <span className={styles.prioritiesTitle}>
        {total === null
          ? 'Открытые рекомендации'
          : `${formatNumber(total)} ${pluralize(total, ['открытая рекомендация', 'открытые рекомендации', 'открытых рекомендаций'])}`}
      </span>
      <ul className={styles.priorityRows}>
        {rows.map((row) => (
          <li key={row.priority}>
            <Link
              className={styles.priorityRow}
              href={`${ROUTES.recommendations}${buildQuery({ priority: row.priority })}`}
              aria-label={`${RECOMMENDATION_PRIORITY_LABELS[row.priority]} приоритет: ${row.count ?? '…'} — открыть в рекомендациях`}
            >
              <PriorityBadge priority={row.priority} />
              <span className={styles.priorityCount}>{row.count === null ? '…' : formatNumber(row.count)}</span>
              <Icon name="chevronRight" size={16} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
