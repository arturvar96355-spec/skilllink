'use client'

import Link from 'next/link'
import type { CSSProperties } from 'react'
import { STAGE_PHASE_LABELS, type CooperationListItemDto, type MetricTrendDto } from '@/shared/contracts'
import { WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import { cooperationHref, formatNumber, formatRelative, pluralize, useCountUp } from '@/ui'
import styles from './LiveRail.module.css'

const TOTAL_STAGES = 14
/** Больше точек линия не держит: дальше подписи сливаются. Остаток называется числом. */
const MAX_DOTS = 24
/** Расстояние между точками одного этапа, px. */
const DOT_GAP = 14

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
}

/** Длина шкалы метки «времени до занятий»: год. */
const TIMELINE_DAYS = 365
const SEGMENTS = 10

/** Фазы конвейера — отрезками маршрута, по конфигурации этапов, а не по памяти. */
const PHASES = WORKFLOW_STAGES.reduce<Array<{ phase: keyof typeof STAGE_PHASE_LABELS; from: number; to: number }>>(
  (list, stage) => {
    const last = list.at(-1)
    if (last && last.phase === stage.phase) last.to = stage.number
    else list.push({ phase: stage.phase, from: stage.number, to: stage.number })
    return list
  },
  [],
)

/** Середина этапа на маршруте, в процентах ширины. */
const stageAt = (stage: number): number => ((stage - 0.5) / TOTAL_STAGES) * 100

function isStuck(item: CooperationListItemDto): boolean {
  return item.progress.overdueStages > 0 || item.progress.blockedStages > 0
}

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
}: {
  numbers: RailNumber[]
  cooperations: CooperationListItemDto[]
  problemTotal: number
  generatedAt: string
}) {
  const onRail = cooperations.filter((item) => item.currentStage !== null)
  const shown = onRail.slice(0, MAX_DOTS)
  const hidden = onRail.length - shown.length

  const perStage = new Map<number, number>()
  const placed = shown.map((item, index) => {
    const stage = item.currentStage!.stageNumber
    const stack = perStage.get(stage) ?? 0
    perStage.set(stage, stack + 1)
    return { item, index, stage, stack }
  })
  // Связки одного этапа — рядом, по центру этапа, не друг на друге.
  const dots = placed.map((dot) => ({
    ...dot,
    shift: (dot.stack - ((perStage.get(dot.stage) ?? 1) - 1) / 2) * DOT_GAP,
  }))
  // Подпись — одна на этап, в ширину этапа (решение 130): подписи у каждой точки
  // наезжали на соседние этапы. Первая связка этапа названа, остальные — «+N».
  const stageLabels = [...perStage.entries()].map(([stage, count]) => {
    const first = placed.find((dot) => dot.stage === stage)!.item
    return { stage, count, name: first.universityShortName ?? first.universityName }
  })

  return (
    <section className={styles.rail} aria-label="Активно сейчас">
      <span className={styles.kicker}>Активно сейчас</span>

      {/* Сравнение за 30 дней — в обоих режимах: это данные, а не украшение (ТЗ фронту, задача 1). */}
      <div className={styles.numbers}>
        {numbers.map((number, index) => (
          <RailValue key={number.key} number={number} order={index} showTrend />
        ))}
      </div>

      <div className={styles.track}>
        <span className={styles.line} aria-hidden />
        {Array.from({ length: TOTAL_STAGES }, (_, index) => (
          <span
            key={index}
            className={styles.tick}
            style={{ left: `${stageAt(index + 1)}%`, '--t': index } as CSSProperties}
            aria-hidden
          />
        ))}

        {PHASES.map((phase) => (
          <span
            key={phase.phase}
            className={styles.phase}
            style={{
              left: `${((phase.from - 1) / TOTAL_STAGES) * 100}%`,
              width: `${((phase.to - phase.from + 1) / TOTAL_STAGES) * 100}%`,
            }}
          >
            {STAGE_PHASE_LABELS[phase.phase]}
          </span>
        ))}

        <ul className={styles.dots} aria-label="Связки в работе на маршруте из 14 этапов">
          {dots.map(({ item, index, stage, shift }) => {
            const name = item.universityShortName ?? item.universityName
            const stuck = isStuck(item)
            return (
              <li
                key={item.id}
                className={styles.dotItem}
                style={
                  {
                    left: `calc(${stageAt(stage)}% + ${shift}px)`,
                    '--i': index,
                  } as CSSProperties
                }
              >
                <Link
                  href={cooperationHref(item.id)}
                  className={[styles.dot, stuck ? styles.stuck : ''].filter(Boolean).join(' ')}
                  aria-label={`${name}, ${item.programName}: этап ${stage} из ${TOTAL_STAGES}${stuck ? ', требует внимания' : ''}`}
                  title={`${name} — ${item.programName}\nЭтап ${stage}: ${item.currentStage!.title}`}
                />
              </li>
            )
          })}
        </ul>

        {stageLabels.map(({ stage, count, name }) => (
          <span
            key={stage}
            className={styles.stageLabel}
            style={{ left: `${((stage - 1) / TOTAL_STAGES) * 100}%`, width: `${100 / TOTAL_STAGES}%` } as CSSProperties}
            title={name}
            aria-hidden
          >
            <span className={styles.stageName}>{name}</span>
            {count > 1 && <span className={styles.stageMore}>+{count - 1}</span>}
          </span>
        ))}
      </div>

      <div className={styles.foot}>
        <a href="#attention" className={styles.attention}>
          {problemTotal === 0
            ? 'Этапов, требующих внимания, нет'
            : `${formatNumber(problemTotal)} ${pluralize(problemTotal, ['этап требует', 'этапа требуют', 'этапов требуют'])} внимания`}
        </a>
        <span className={styles.fresh}>
          {hidden > 0 && `на маршруте первые ${shown.length} из ${formatNumber(onRail.length)} · `}
          обновлено {formatRelative(generatedAt)}
        </span>
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
      {(number.note || number.isMock || (showTrend && number.trend)) && (
        <span className={styles.note}>
          {showTrend && number.trend && <RailTrend trend={number.trend} isShare={number.isShare ?? false} />}
          {number.note}
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
