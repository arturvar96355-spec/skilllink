import { PROGRAM_LEVEL_LABELS, PROGRAM_STATUS_LABELS, type Metric, type ProgramListItemDto } from '@/shared/contracts'
import { FactSheet, MockBadge, formatNumber } from '@/ui'

/** Факты программы рядом с каруселью бирок (решение 79). */
function metric(value: Metric): string {
  if (value.value === null) return 'Нет данных'
  return `${value.basis === 'estimate' ? '≈' : ''}${formatNumber(value.value)}`
}

export function ProgramFacts({ row }: { row: ProgramListItemDto }) {
  return (
    <FactSheet
      kicker={
        <>
          {row.universityShortName ?? row.universityName} · {PROGRAM_LEVEL_LABELS[row.level]}{' '}
          {row.isMock && <MockBadge />}
        </>
      }
      title={row.name}
      facts={[
        { label: 'Код', value: row.code ?? 'Нет данных' },
        { label: 'Направление', value: row.direction ?? 'Нет данных' },
        {
          label: 'Срок',
          value: row.durationMonths === null ? 'Нет данных' : `${formatNumber(row.durationMonths)} мес.`,
        },
        { label: 'Статус', value: PROGRAM_STATUS_LABELS[row.status] },
        { label: 'Заявки', value: metric(row.metrics.applicationCount) },
        { label: 'Обучаются', value: metric(row.metrics.studentCount) },
        { label: 'Группы', value: metric(row.metrics.groupCount) },
        { label: 'Связки', value: formatNumber(row.cooperationCount) },
      ]}
    />
  )
}
