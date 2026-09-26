'use client'

import { Fragment, type CSSProperties } from 'react'
import type { MeetingsHeatmapDto } from '@/shared/contracts'
import { Card, EmptyState, ErrorState, MockBadge, Section, TableSkeleton, useResource } from '@/ui'
import { heatIntensity } from './heatmap-color'
import styles from './MeetingsHeatmap.module.css'

/**
 * Тепловая карта проведённых встреч 7×24 (решение 134, п. 7 решения 178):
 * когда реально встречаются с вузами — день недели × час по Москве.
 */
export function MeetingsHeatmap() {
  const heatmap = useResource<MeetingsHeatmapDto>('/api/analytics/meetings-heatmap')

  return (
    <Section
      title="Когда проходят встречи"
      description="Проведённые встречи по дню недели и часу, московское время. Помогает увидеть, когда с вузами реально удаётся встречаться, а не только планировать."
      action={heatmap.data?.isMock ? <MockBadge /> : undefined}
    >
      <Card>
        {heatmap.isLoading ? (
          <TableSkeleton rows={7} columns={8} />
        ) : heatmap.error ? (
          <ErrorState error={heatmap.error} onRetry={heatmap.reload} />
        ) : !heatmap.data || heatmap.data.total === 0 ? (
          <EmptyState
            icon="calendar"
            title="Проведённых встреч нет"
            description="За выбранный период в системе не зафиксировано ни одной прошедшей встречи."
          />
        ) : (
          <HeatmapGrid data={heatmap.data} />
        )}
      </Card>
    </Section>
  )
}

function cellStyle(value: number, max: number): CSSProperties {
  const intensity = heatIntensity(value, max)
  if (intensity === 0) return {}
  return { background: `color-mix(in srgb, var(--accent-violet) ${intensity}%, var(--surface-sunken))` }
}

function HeatmapGrid({ data }: { data: MeetingsHeatmapDto }) {
  const hours = Array.from({ length: 24 }, (_, hour) => hour)

  return (
    <div className={styles.wrap}>
      <div className={styles.grid}>
        <span aria-hidden="true" />
        {hours.map((hour) => (
          <span key={hour} className={styles.hourLabel}>
            {hour}
          </span>
        ))}

        {data.dayLabels.map((label, dayIndex) => (
          <Fragment key={label}>
            <span className={styles.dayLabel}>{label}</span>
            {hours.map((hour) => {
              const value = data.cells[dayIndex]?.[hour] ?? 0
              return (
                <span
                  key={`${label}-${hour}`}
                  className={styles.cell}
                  style={cellStyle(value, data.max)}
                  title={`${label}, ${hour}:00 — ${value} ${value === 1 ? 'встреча' : 'встреч'}`}
                />
              )
            })}
          </Fragment>
        ))}
      </div>

      <span className={styles.legend}>
        Всего встреч: {data.total} · часовой пояс {data.timeZone}
        <span className={styles.legendScale}>
          {[0, 25, 50, 75, 100].map((step) => (
            <span
              key={step}
              className={styles.legendCell}
              style={step === 0 ? {} : cellStyle(step, 100)}
              aria-hidden="true"
            />
          ))}
        </span>
      </span>
    </div>
  )
}
