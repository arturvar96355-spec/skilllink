'use client'

import Link from 'next/link'
import type { CSSProperties } from 'react'
import { STAGE_PHASE_LABELS, type CooperationListItemDto } from '@/shared/contracts'
import { WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import { cooperationHref, formatNumber, formatRelative, pluralize, useCountUp } from '@/ui'
import styles from './LiveRail.module.css'

const TOTAL_STAGES = 14
/** Больше точек линия не держит: дальше подписи сливаются. Остаток называется числом. */
const MAX_DOTS = 24
/** Подписей над одним этапом — не больше двух, остальные — «+N». */
const MAX_LABELS_PER_STAGE = 2
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
}

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

  return (
    <section className={styles.rail} aria-label="Активно сейчас">
      <span className={styles.kicker}>Активно сейчас</span>

      <div className={styles.numbers}>
        {numbers.map((number, index) => (
          <RailValue key={number.key} number={number} order={index} />
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
          {dots.map(({ item, index, stage, stack, shift }) => {
            const name = item.universityShortName ?? item.universityName
            const stuck = isStuck(item)
            const labelled = stack < MAX_LABELS_PER_STAGE
            const extra = (perStage.get(stage) ?? 0) - MAX_LABELS_PER_STAGE
            return (
              <li
                key={item.id}
                className={styles.dotItem}
                style={
                  {
                    left: `calc(${stageAt(stage)}% + ${shift}px)`,
                    '--i': index,
                    '--stack': stack,
                  } as CSSProperties
                }
              >
                <Link
                  href={cooperationHref(item.id)}
                  className={[styles.dot, stuck ? styles.stuck : ''].filter(Boolean).join(' ')}
                  aria-label={`${name}, ${item.programName}: этап ${stage} из ${TOTAL_STAGES}${stuck ? ', требует внимания' : ''}`}
                  title={`${name} — ${item.programName}\nЭтап ${stage}: ${item.currentStage!.title}`}
                />
                {labelled && (
                  <span className={styles.dotLabel} aria-hidden>
                    {name}
                  </span>
                )}
                {stack === MAX_LABELS_PER_STAGE && extra > 0 && (
                  <span className={styles.dotMore} aria-hidden>
                    +{extra}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
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

function RailValue({ number, order }: { number: RailNumber; order: number }) {
  const animated = useCountUp(number.value, 900)
  const shown =
    animated === null
      ? null
      : number.digits > 0
        ? Number(animated.toFixed(number.digits))
        : Math.round(animated)

  return (
    <div
      className={[styles.number, number.secondary ? styles.secondary : ''].filter(Boolean).join(' ')}
      style={{ '--order': order } as CSSProperties}
      title={number.explanation}
    >
      <span className={styles.value}>
        {shown === null
          ? 'Нет данных'
          : number.digits > 0
            ? shown.toFixed(number.digits).replace('.', ',')
            : formatNumber(shown)}
        {shown !== null && number.unit && <span className={styles.unit}>{number.unit}</span>}
      </span>
      <span className={styles.label}>{number.label}</span>
      {(number.note || number.isMock) && (
        <span className={styles.note}>
          {number.note}
          {number.isMock && <span className={styles.mock}>демо</span>}
        </span>
      )}
    </div>
  )
}
