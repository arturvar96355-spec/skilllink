'use client'

import type { ReactNode } from 'react'
import type { Metric } from '@/shared/contracts'
import { Card } from '../primitives/Card'
import { Icon, type IconName } from '../primitives/Icon'
import { Tooltip } from '../primitives/Tooltip'
import { useCountUp } from '../hooks/dom'
import { NO_DATA, formatMetric, formatNumber } from '../lib/format'
import styles from './Metric.module.css'

/**
 * Значение показателя с его происхождением.
 *
 * Правило проекта (решение 8): `value === null` печатается как «Нет данных»
 * и никогда как ноль. Рядом — объяснение, откуда взялось число: его присылает
 * сервер в поле `explanation`, придумывать своё не нужно.
 */
export function MetricValue({ metric }: { metric: Metric | null | undefined }) {
  const isEmpty = !metric || metric.value === null
  return (
    <span className={isEmpty ? styles.valueEmpty : styles.value}>
      {formatMetric(metric)}
      {metric?.basis === 'estimate' && <span className={styles.estimate}>оценка</span>}
      {metric?.explanation && (
        <Tooltip text={metric.explanation}>
          <span className={styles.explain}>
            <Icon name="info" size={16} />
          </span>
        </Tooltip>
      )}
    </span>
  )
}

export interface KpiCardProps {
  label: string
  /** null — «Нет данных». */
  value: number | null
  unit?: string
  icon?: IconName
  /** Откуда число: показывается подсказкой у значка вопроса. */
  explanation?: string | null
  /** Короткая строка под значением: период, основание, уточнение. */
  note?: string
  footer?: ReactNode
  /** Дробная часть: у процентов она нужна, у счётчиков — нет. */
  fractionDigits?: number
}

/**
 * Плитка показателя на дашборде.
 *
 * Значение добегает до настоящего за 800 мс (раздел 9 документа о движении)
 * и всегда останавливается ровно на нём. Если данных нет, анимации нет вовсе:
 * «Нет данных» нельзя анимировать из нуля — получится, что ноль был.
 */
export function KpiCard({
  label,
  value,
  unit,
  icon,
  explanation,
  note,
  footer,
  fractionDigits = 0,
}: KpiCardProps) {
  const animated = useCountUp(value)
  const shown =
    animated === null
      ? null
      : fractionDigits > 0
        ? Number(animated.toFixed(fractionDigits))
        : Math.round(animated)

  return (
    <Card className={styles.kpi}>
      <div className={styles.kpiHead}>
        <span className={styles.kpiLabel}>
          {label}
          {explanation && (
            <Tooltip text={explanation}>
              <span className={styles.explain}>
                <Icon name="info" size={16} />
              </span>
            </Tooltip>
          )}
        </span>
        {icon && (
          <span className={styles.kpiIcon}>
            <Icon name={icon} size={18} />
          </span>
        )}
      </div>

      {shown === null ? (
        <span className={styles.kpiEmpty}>{NO_DATA}</span>
      ) : (
        <span className={styles.kpiValue}>
          {fractionDigits > 0 ? shown.toFixed(fractionDigits).replace('.', ',') : formatNumber(shown)}
          {unit && <span className={styles.kpiUnit}>{unit}</span>}
        </span>
      )}

      {(note || footer) && (
        <div className={styles.kpiFooter}>
          {note && <span className={styles.kpiNote}>{note}</span>}
          {footer}
        </div>
      )}
    </Card>
  )
}

/**
 * Показатель в ячейке таблицы.
 *
 * В строке реестра нет места для «360 заявки · оценка · ⓘ»: единица уже
 * в заголовке столбца, а три элемента в узком столбце налезают на соседний.
 * Здесь только число. Оценочное значение помечено знаком «≈», объяснение
 * происхождения — в подсказке при наведении. Пустое — «Нет данных», не ноль.
 */
export function MetricCell({ metric }: { metric: Metric | null | undefined }) {
  if (!metric || metric.value === null) {
    return (
      <span className={styles.valueEmpty} title={metric?.explanation}>
        {NO_DATA}
      </span>
    )
  }
  const isEstimate = metric.basis === 'estimate'
  return (
    <span
      className={styles.value}
      title={isEstimate ? `Оценка. ${metric.explanation}` : metric.explanation}
    >
      {isEstimate && <span className={styles.estimateMark}>≈</span>}
      {formatNumber(metric.value)}
    </span>
  )
}

export interface KpiStripItem {
  key: string
  label: string
  value: number | null
  unit?: string
  explanation?: string | null
  /** Короткая пометка под значением: «оценка», период. */
  note?: string
  fractionDigits?: number
  isMock?: boolean
}

/**
 * Показатели одной строкой.
 *
 * Пять плиток одинакового веса занимали полэкрана и спорили за внимание
 * с тем, ради чего открывают главную, — со списком проблем. Здесь те же
 * цифры в одну полосу: видны сразу, но не забирают первый экран.
 */
export function KpiStrip({ items }: { items: KpiStripItem[] }) {
  return (
    <Card padding="none" className={styles.strip}>
      {items.map((item) => (
        <KpiStripCell key={item.key} item={item} />
      ))}
    </Card>
  )
}

function KpiStripCell({ item }: { item: KpiStripItem }) {
  const animated = useCountUp(item.value)
  const digits = item.fractionDigits ?? 0
  const shown =
    animated === null ? null : digits > 0 ? Number(animated.toFixed(digits)) : Math.round(animated)

  return (
    <div className={styles.stripCell} title={item.explanation ?? undefined}>
      <span className={styles.stripLabel}>{item.label}</span>
      {shown === null ? (
        <span className={styles.stripEmpty}>{NO_DATA}</span>
      ) : (
        <span className={styles.stripValue}>
          {digits > 0 ? shown.toFixed(digits).replace('.', ',') : formatNumber(shown)}
          {item.unit && <span className={styles.stripUnit}>{item.unit}</span>}
        </span>
      )}
      {(item.note || item.isMock) && (
        <span className={styles.stripNote}>
          {item.note}
          {item.isMock && <span className={styles.stripMock}>демо</span>}
        </span>
      )}
    </div>
  )
}
