import {
  PROGRAM_LEVEL_LABELS,
  PROGRAM_STATUS_LABELS,
  type Metric,
  type ProgramListItemDto,
} from '@/shared/contracts'
import { formatNumber } from '@/ui'
import styles from './ProgramTag.module.css'

/*
 * Бирка программы для 3D-карусели реестра (решение 73).
 *
 * Чтобы не повторять светлые бирки вузов, программа — тёмный «билет на курс»:
 * сверху цветная полоса с уровнем и кодом, в середине название и вуз, внизу —
 * отрывной корешок по перфорации с показателями набора. Цвет полосы — по уровню:
 * бакалавриат и магистратуру видно в веере, не читая подписей.
 */

const LEVEL_TONES: Record<ProgramListItemDto['level'], string> = {
  SPO: styles.toneCyan!,
  BACHELOR: styles.toneViolet!,
  SPECIALIST: styles.toneViolet!,
  MASTER: styles.tonePink!,
  POSTGRADUATE: styles.toneOrange!,
  DPO: styles.toneCyan!,
}

/** Показатель набора: «Нет данных» — не ноль; оценка помечена «≈». */
function MetricValue({ metric }: { metric: Metric }) {
  if (metric.value === null) return <span className={styles.noData}>Нет данных</span>
  return (
    <span className={styles.statValue} title={metric.explanation}>
      {metric.basis === 'estimate' && '≈'}
      {formatNumber(metric.value)}
    </span>
  )
}

export function ProgramTag({ row }: { row: ProgramListItemDto }) {
  const university = row.universityShortName ?? row.universityName
  return (
    <span className={`${styles.ticket} ${LEVEL_TONES[row.level]}`}>
      <span className={styles.band}>
        <span className={styles.level}>{PROGRAM_LEVEL_LABELS[row.level]}</span>
        <span className={styles.code}>{row.code ?? '—'}</span>
      </span>

      <span className={styles.body}>
        <span className={styles.meta}>
          <span className={styles.status}>{PROGRAM_STATUS_LABELS[row.status]}</span>
          {row.isMock && <span className={styles.stamp}>Демо</span>}
        </span>
        <span className={styles.name}>{row.name}</span>
        <span className={styles.route}>
          <span className={styles.university}>{university}</span>
          {row.direction && (
            <>
              <span className={styles.arrow} aria-hidden>
                →
              </span>
              <span className={styles.direction}>{row.direction}</span>
            </>
          )}
        </span>
        <span className={styles.facts}>
          <span>
            <span className={styles.label}>Срок</span>
            <span className={styles.fact}>
              {row.durationMonths === null ? 'Нет данных' : `${formatNumber(row.durationMonths)} мес.`}
            </span>
          </span>
          <span>
            <span className={styles.label}>Навыки</span>
            <span className={styles.fact}>{formatNumber(row.skillCount)}</span>
          </span>
          <span>
            <span className={styles.label}>Связки</span>
            <span className={styles.fact}>{formatNumber(row.cooperationCount)}</span>
          </span>
        </span>
      </span>

      {/* Перфорация: вырезы по краям и пунктир — корешок «отрывается». */}
      <span className={styles.perforation} aria-hidden />

      <span className={styles.stub}>
        <span className={styles.stat}>
          <span className={styles.label}>Заявки</span>
          <MetricValue metric={row.metrics.applicationCount} />
        </span>
        <span className={styles.stat}>
          <span className={styles.label}>Обучаются</span>
          <MetricValue metric={row.metrics.studentCount} />
        </span>
        <span className={styles.stat}>
          <span className={styles.label}>Группы</span>
          <MetricValue metric={row.metrics.groupCount} />
        </span>
      </span>
    </span>
  )
}
