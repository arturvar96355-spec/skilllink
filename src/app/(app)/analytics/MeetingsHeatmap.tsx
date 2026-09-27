'use client'

import { Fragment, type CSSProperties } from 'react'
import type { MeetingsHeatmapDto } from '@/shared/contracts'
import { Card, EmptyState, ErrorState, MockBadge, ScrollArea, Section, TableSkeleton, pluralize, useResource } from '@/ui'
import { dayTotals, heatIntensity, heatmapConclusion } from './heatmap-color'
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
      description={
        heatmap.data
          ? heatmapConclusion(heatmap.data.cells, heatmap.data.total)
          : 'Когда с вузами реально удаётся встречаться — по дню недели и часу.'
      }
      hint="Проведённые встречи по дню недели и часу, московское время. Число в клетке — сколько встреч было в этот час этого дня недели за весь период; чем темнее клетка, тем их больше. Справа — сколько встреч за день и какая это доля от всех. Помогает увидеть, когда с вузами реально удаётся встречаться, а не только планировать."
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
  return {
    background: `color-mix(in srgb, var(--accent-violet) ${intensity}%, var(--surface-sunken))`,
    // Число в клетке читается на любой насыщенности: на тёмной — светлым, на светлой — обычным.
    color: intensity >= 60 ? 'var(--text-inverse)' : undefined,
  }
}

function HeatmapGrid({ data }: { data: MeetingsHeatmapDto }) {
  const hours = Array.from({ length: 24 }, (_, hour) => hour)
  const totals = dayTotals(data.cells)

  return (
    <div className={styles.wrap}>
      {/* Сетка шире узкого экрана листается вбок с растворённым краем (решение 195). */}
      <ScrollArea label="Тепловая карта встреч по дням и часам">
        <div className={styles.grid}>
          <span aria-hidden="true" />
          {hours.map((hour) => (
            <span key={hour} className={styles.hourLabel}>
              {hour}
            </span>
          ))}
          <span className={styles.totalHead}>за день</span>

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
                    role="img"
                    aria-label={`${label}, ${hour}:00 — ${value} ${pluralize(value, ['встреча', 'встречи', 'встреч'])}`}
                  >
                    {value > 0 ? value : ''}
                  </span>
                )
              })}
              <span className={styles.total}>
                <span className={styles.totalValue}>{totals[dayIndex] ?? 0}</span>
                <span className={styles.totalShare}>
                  {data.total > 0 ? `${Math.round(((totals[dayIndex] ?? 0) / data.total) * 100)} %` : ''}
                </span>
              </span>
            </Fragment>
          ))}
        </div>
      </ScrollArea>

      <span className={styles.legend}>
        Всего встреч: {data.total} · московское время
        <span className={styles.legendText}>меньше</span>
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
        <span className={styles.legendText}>больше</span>
      </span>
    </div>
  )
}
