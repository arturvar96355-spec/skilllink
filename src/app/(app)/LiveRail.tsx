'use client'

import Link from 'next/link'
import type { CSSProperties } from 'react'
import type { CooperationListItemDto, MetricTrendDto } from '@/shared/contracts'
import { formatNumber, formatRelative, pluralize, useCountUp } from '@/ui'
import { LiveRailRoute } from './LiveRailRoute'
import type { RouteView } from './route-rail'
import styles from './LiveRail.module.css'

/**
 * Вид маршрута связок (решение 202): «count» — точка с числом на этапе (А),
 * «column» — столбик точек до пяти и «+N» (Б). Переключение — эта строка
 * или проп `routeView` у `LiveRail`.
 */
const ROUTE_VIEW: RouteView = 'count'

export interface RailNumber {
  key: string
  label: string
  value: number | null
  unit?: string
  note?: string
  digits: number
  isMock: boolean
  explanation: string
  /** Второстепенный показатель — мельче, в конце строки. */
  secondary?: boolean
  /**
   * Своё движение у каждого числа (07, раздел 20): одинаковый счёт у всех
   * превращал строку в шаблон. «count» — счёт и дорисовка линии связи,
   * «segments» — заполнение делений до доли, «timeline» — метка на шкале года,
   * «still» — без счёта: движение берёт на себя маршрут под числами.
   */
  motion?: 'count' | 'segments' | 'timeline' | 'still'
  /** Сравнение с прошлым периодом — только у «Активных связей» и «Этапов в срок». */
  trend?: MetricTrendDto | null
  /** Доля в процентах: изменение — в процентных пунктах, а не в штуках. */
  isShare?: boolean
  /**
   * Куда ведёт показатель (пробел ТЗ «кликабельные показатели главной»,
   * решение 153): список с уже применённым фильтром, а где подходящего
   * фильтра у списка нет — список без фильтра. У показателя, для которого
   * подходящего списка вообще нет (операций на связку — расчётная величина,
   * а не выборка записей), поля нет — плитка остаётся текстом.
   */
  href?: string
  /** Знаменатель доли, готовой строкой: «из 92 этапов» (решение 180, п. 2). */
  denominatorLabel?: string
}

/** Длина шкалы метки «времени до занятий»: год. */
const TIMELINE_DAYS = 365
const SEGMENTS = 10

/**
 * SkillLink Live Rail — главный блок главной (07, разделы 6 и 20).
 *
 * Не пять одинаковых плиток, а одна композиция: числа сверху, под ними маршрут
 * из четырнадцати этапов, на нём — связки в работе, каждая на своём текущем
 * этапе, подписанная вузом. Застрявшие отмечены цветом и одним импульсом при
 * появлении. Точки и линия — данные, а не украшение: где на маршруте стоит
 * работа и где она встала.
 */
export function LiveRail({
  numbers,
  cooperations,
  problemTotal,
  generatedAt,
  routeView = ROUTE_VIEW,
}: {
  numbers: RailNumber[]
  cooperations: CooperationListItemDto[]
  problemTotal: number
  generatedAt: string
  routeView?: RouteView
}) {

  return (
    <section className={styles.rail} aria-label="Активно сейчас">
      <span className={styles.kicker}>Активно сейчас</span>

      {/* Сравнение за 30 дней — в обоих режимах: это данные, а не украшение (ТЗ фронту, задача 1). */}
      <div className={styles.numbers}>
        {numbers.map((number, index) => (
          <RailValue key={number.key} number={number} order={index} showTrend />
        ))}
      </div>

      <LiveRailRoute cooperations={cooperations} view={routeView} />

      <div className={styles.foot}>
        <a href="#attention" className={styles.attention}>
          {problemTotal === 0
            ? 'Этапов, требующих внимания, нет'
            : `${formatNumber(problemTotal)} ${pluralize(problemTotal, ['этап требует', 'этапа требуют', 'этапов требуют'])} внимания`}
        </a>
        <span className={styles.fresh}>обновлено {formatRelative(generatedAt)}</span>
      </div>
    </section>
  )
}

function RailValue({ number, order, showTrend }: { number: RailNumber; order: number; showTrend: boolean }) {
  const motion = number.motion ?? 'count'
  const counted = useCountUp(number.value, 900)
  const animated = motion === 'count' ? counted : number.value
  const shown =
    animated === null
      ? null
      : number.digits > 0
        ? Number(animated.toFixed(number.digits))
        : Math.round(animated)

  const className = [styles.number, number.secondary ? styles.secondary : '', number.href ? styles.numberLink : '']
    .filter(Boolean)
    .join(' ')

  const content = (
    <>
      <span className={styles.value}>
        {shown === null
          ? 'Нет данных'
          : number.digits > 0
            ? shown.toFixed(number.digits).replace('.', ',')
            : formatNumber(shown)}
        {shown !== null && number.unit && <span className={styles.unit}>{number.unit}</span>}
      </span>
      {/* Место под движение есть у каждого числа: иначе числа с полоской
          вставали выше соседних. */}
      <span className={styles.motion}>
        {number.value !== null && <RailMotion motion={motion} value={number.value} />}
      </span>
      <span className={styles.label}>{number.label}</span>
      {/* Сравнение — в строке пометок, а не отдельной строкой: ряд чисел выровнен
          по нижнему краю, и лишняя строка поднимала бы свою колонку над соседними. */}
      {(number.note || number.denominatorLabel || number.isMock || (showTrend && number.trend)) && (
        <span className={styles.note}>
          {showTrend && number.trend && <RailTrend trend={number.trend} isShare={number.isShare ?? false} />}
          {number.note}
          {/* Знаменатель доли — прямо под числом, а не только в подсказке при
              наведении (решение 180, п. 2): «68% из 92 этапов», а не голое «68%». */}
          {number.denominatorLabel}
          {number.isMock && <span className={styles.mock}>демо</span>}
        </span>
      )}
    </>
  )

  // Показатель без списка, на который можно сослаться (операций на связку — расчётная
  // величина), остаётся текстом: div, а не ссылка в никуда.
  if (number.href) {
    return (
      <Link
        href={number.href}
        className={className}
        style={{ '--order': order } as CSSProperties}
        title={number.explanation}
      >
        {content}
      </Link>
    )
  }

  return (
    <div className={className} style={{ '--order': order } as CSSProperties} title={number.explanation}>
      {content}
    </div>
  )
}

function RailMotion({ motion, value }: { motion: NonNullable<RailNumber['motion']>; value: number }) {
  if (motion === 'count') return <span className={styles.linkLine} aria-hidden />
  if (motion === 'segments') {
    const filled = Math.round(Math.min(Math.max(value, 0), 100) / SEGMENTS)
    return (
      <span className={styles.segments} aria-hidden>
        {Array.from({ length: SEGMENTS }, (_, index) => (
          <span
            key={index}
            className={index < filled ? `${styles.segment} ${styles.segmentOn}` : styles.segment}
            style={{ '--s': index } as CSSProperties}
          />
        ))}
      </span>
    )
  }
  if (motion === 'timeline') {
    const at = Math.min(Math.max(value, 0) / TIMELINE_DAYS, 1) * 100
    return (
      <span className={styles.timeline} title="Шкала — год" aria-hidden>
        <span className={styles.marker} style={{ '--at': `${at}%` } as CSSProperties} />
      </span>
    )
  }
  return null
}

/**
 * Сравнение с прошлым периодом (ТЗ фронту, задача 1): «+1 за 30 дней» — рост
 * зелёным, падение красным, без изменений — нейтрально и без стрелки.
 * `trend: null` — строки нет совсем, без заглушки.
 */
function RailTrend({ trend, isShare }: { trend: MetricTrendDto; isShare: boolean }) {
  const size = Math.abs(trend.delta)
  const amount = isShare ? `${formatNumber(Number(size.toFixed(1)))} п.п.` : formatNumber(size)
  const sign = trend.direction === 'up' ? '+' : trend.direction === 'down' ? '−' : ''
  return (
    <span className={[styles.trend, styles[trend.direction]].join(' ')} title={`Было ${formatNumber(trend.previous)}`}>
      {trend.direction !== 'flat' && (
        <span className={styles.trendArrow} aria-hidden>
          {trend.direction === 'up' ? '↑' : '↓'}
        </span>
      )}
      {/* «Без изменений» словами не пишется (ТЗ фронту, задача 1) — ноль и нейтральный цвет. */}
      {sign}
      {trend.direction === 'flat' ? (isShare ? '0 п.п.' : '0') : amount} {trend.periodLabel}
    </span>
  )
}
