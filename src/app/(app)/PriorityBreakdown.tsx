'use client'

import Link from 'next/link'
import {
  type RecommendationDto,
  type RecommendationPriority,
} from '@/shared/contracts'
import { OPEN_RECOMMENDATION_STATUSES, QueueFoot, QueueFootLink, ROUTES, buildQuery, formatNumber, useResource } from '@/ui'
import styles from './PriorityQueue.module.css'

/** Число открытых рекомендаций одного приоритета — из `meta.total`, строки не нужны. */
function useOpenCount(priority: RecommendationPriority) {
  const resource = useResource<RecommendationDto[]>(
    `/api/recommendations${buildQuery({ status: OPEN_RECOMMENDATION_STATUSES, priority, pageSize: 1 })}`,
  )
  return { count: resource.meta?.total ?? null, error: resource.error }
}

/** «критичных 3» — прилагательное во мн. ч. род. п.: одна форма на любое число после «Всего открыто N:». */
const PRIORITY_WORDS: Record<RecommendationPriority, string> = {
  CRITICAL: 'критичных',
  HIGH: 'высоких',
  MEDIUM: 'средних',
  LOW: 'низких',
}

/**
 * Открытые рекомендации по приоритету — подвалом очереди «Приоритетные действия».
 *
 * Сервер отдаёт на главную пять самых важных; здесь — сколько всего открытого
 * за ними, и каждое число ведёт в ленту с уже выбранным приоритетом (ТЗ дизайна
 * 26–29.09, п. 3.5). Решение 206: одной строкой в подвале очереди вместо сетки
 * из четырёх плашек — колонка больше не свисает ниже соседнего блока. Сюда
 * входят и просрочки этапов (`stage.overdue`): в пятёрке их нет (решение 180),
 * они в соседнем блоке — это сказано прямо, чтобы «критичных 3» не читалось как
 * «критичные есть, а показаны высокие».
 */
export function PriorityBreakdown() {
  // Хуки — по одному на приоритет, в постоянном порядке.
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

  const allLink = <QueueFootLink href={ROUTES.recommendations}>Весь список задач</QueueFootLink>

  // Не ответил хотя бы один запрос или ещё грузится — только ссылка: неполная сводка хуже никакой.
  if (rows.some((row) => row.error) || rows.some((row) => row.count === null)) {
    return <QueueFoot>{allLink}</QueueFoot>
  }
  const total = rows.reduce((sum, row) => sum + (row.count ?? 0), 0)
  const present = rows.filter((row) => (row.count ?? 0) > 0)

  return (
    <QueueFoot>
      <span className={styles.summaryText}>
        Всего открыто {formatNumber(total)}
        {present.length > 0 && ': '}
        {present.map((row, index) => (
          <span key={row.priority}>
            {index > 0 && ', '}
            <Link
              className={styles.summaryLink}
              href={`${ROUTES.recommendations}${buildQuery({ priority: row.priority })}`}
            >
              {PRIORITY_WORDS[row.priority]} {formatNumber(row.count)}
            </Link>
          </span>
        ))}
        . Просрочки этапов — в «Требует внимания».
      </span>
      {allLink}
    </QueueFoot>
  )
}
