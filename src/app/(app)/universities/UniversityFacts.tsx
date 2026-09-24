import { UNIVERSITY_STATUS_LABELS, type UniversityListItemDto } from '@/shared/contracts'
import { FactSheet, MockBadge, formatDate, formatNumber, formatScore } from '@/ui'
import { logoFor } from './university-logos'
import styles from './UniversityFacts.module.css'

/** Факты вуза рядом с каруселью и в панели графа (решение 79). */
export function UniversityFacts({ row, canSeeAnalytics }: { row: UniversityListItemDto; canSeeAnalytics: boolean }) {
  const logo = logoFor(row.shortName)
  const facts = [
    { label: 'Город', value: row.city },
    { label: 'Регион', value: row.region },
    { label: 'Статус', value: UNIVERSITY_STATUS_LABELS[row.status] },
    { label: 'Программы', value: formatNumber(row.programCount) },
    {
      label: 'Связки',
      value: `${formatNumber(row.activeCooperationCount)} в работе из ${formatNumber(row.cooperationCount)}`,
    },
  ]
  if (canSeeAnalytics) {
    facts.push({
      label: 'Рейтинг',
      value: row.rating?.score == null ? 'Нет данных' : formatScore(row.rating.score),
    })
  }
  facts.push({ label: 'Обновлено', value: formatDate(row.updatedAt) })

  return (
    <FactSheet
      kicker={
        <span className={styles.kicker}>
          {logo && (
            <span className={`${styles.logo} ${logo.plate === 'dark' ? styles.logoDark : ''}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo.src} alt="" />
            </span>
          )}
          {row.shortName ?? 'Вуз'}
          {row.isMock && <MockBadge />}
        </span>
      }
      title={row.name}
      facts={facts}
    />
  )
}
