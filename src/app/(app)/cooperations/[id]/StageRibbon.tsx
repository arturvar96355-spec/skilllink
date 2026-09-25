'use client'

import type { CSSProperties } from 'react'
import { STAGE_PHASES, STAGE_PHASE_LABELS, STAGE_STATUS_LABELS } from '@/shared/contracts'
import type { StagePhase, WorkflowStageDto } from '@/shared/contracts'
import { Icon } from '@/ui'
import styles from './StageRibbon.module.css'

/**
 * Лента этапов связки.
 *
 * Показывает весь путь целиком: где связка была, где стоит и где её ждут
 * контрольные точки. Номера этапов, на которых система не пускает дальше,
 * помечены замком — это и есть главное отличие системы от таблицы,
 * и на экране оно должно быть видно до того, как кто-то нажмёт кнопку.
 *
 * Состав контрольных точек берётся не из вёрстки: сервер присылает этапы,
 * а какие из них контрольные — знает конфигурация процесса. Дублировать
 * этот список здесь нельзя, он поменяется вместе с процессом.
 */
export interface StageRibbonProps {
  stages: WorkflowStageDto[]
  /** Номера этапов-контрольных точек. */
  controlPoints: readonly number[]
  selectedStageId: string | null
  onSelect: (stageId: string) => void
}

/**
 * Глубина этапа относительно текущего (07, раздел 8): текущий — ближе всех,
 * пройденные и будущие уходят назад в перспективе. Прозрачностью этапы больше
 * не гасятся: на проекторе приглушённые номера не читались (ТЗ визуалу, п. 5).
 */
function depthOf(stage: WorkflowStageDto, focus: number): number {
  const distance = stage.stageNumber - focus
  if (distance === 0) return 22
  if (distance < 0) return Math.max(-84, distance * 16)
  return Math.max(-64, -distance * 10)
}

/** Номер этапа в записи маршрута: «06 / 14». */
const notation = (stage: number, total: number) =>
  `${String(stage).padStart(2, '0')} / ${total}`

export function StageRibbon({ stages, controlPoints, selectedStageId, onSelect }: StageRibbonProps) {
  if (stages.length === 0) return null

  const ordered = [...stages].sort((a, b) => a.stageNumber - b.stageNumber)
  // Текущий этап — первый незакрытый (решение 5); этап 14 им не бывает.
  const current =
    ordered.find(
      (stage) =>
        !stage.isAutoManaged && stage.status !== 'COMPLETED' && stage.status !== 'CANCELLED',
    ) ?? null
  const focus = current?.stageNumber ?? ordered.length

  // Ширина колонки одна на все этапы: иначе длинные названия растянут свои
  // столбцы, и шаги окажутся на разном расстоянии друг от друга.
  //
  // 56 пикселей на этап — лента целиком помещается на проекторе 1280×720
  // при раскрытом меню. При 64 не хватало 49 пикселей, и этап 14 уезжал
  // под прокрутку ровно на третьем шаге показа.
  const columns = `repeat(${ordered.length}, minmax(56px, 1fr))`

  const phaseSpans = STAGE_PHASES.map((phase: StagePhase) => {
    const inPhase = ordered.filter((stage) => stage.phase === phase)
    const closed = inPhase.filter(
      (stage) => stage.status === 'COMPLETED' || stage.status === 'CANCELLED',
    ).length
    return {
      phase,
      span: inPhase.length,
      closed,
      isCurrent: inPhase.some((stage) => stage.status === 'IN_PROGRESS'),
    }
  }).filter((item) => item.span > 0)

  const closedCount = ordered.filter(
    (stage) => stage.status === 'COMPLETED' || stage.status === 'CANCELLED',
  ).length
  // Заполненная часть линии доходит до середины последнего закрытого этапа.
  const donePercent =
    closedCount === 0 ? 0 : ((closedCount - 0.5) / ordered.length) * 100

  function stateClass(stage: WorkflowStageDto): string {
    if (stage.status === 'CANCELLED') return styles.cancelled ?? ''
    if (stage.status === 'COMPLETED') return styles.done ?? ''
    /*
     * Четырнадцатый этап вычисляется системой и числится «в работе» всё время,
     * пока открыт хоть один другой. Подсвечивать его как текущий нельзя: взгляд
     * уходил бы в конец ленты вместо этапа, которым человек действительно занят.
     */
    if (stage.isAutoManaged) return ''
    // Просрочка важнее статуса «в работе»: если срок вышел, на ленте это первое,
    // что должно быть видно.
    if (stage.isOverdue) return styles.overdue ?? ''
    if (stage.status === 'BLOCKED') return styles.blocked ?? ''
    if (stage.status === 'IN_PROGRESS') return styles.current ?? ''
    return ''
  }

  return (
    <div className={styles.ribbon}>
      <div className={styles.head}>
        <span className={styles.headLabel}>{current ? 'Текущий этап' : 'Все этапы закрыты'}</span>
        {current && (
          <>
            <span className={styles.headNotation}>{notation(current.stageNumber, ordered.length)}</span>
            <span className={styles.headTitle}>{current.title}</span>
          </>
        )}
      </div>

      <div
        className={styles.phases}
        style={{
          gridTemplateColumns: phaseSpans.map((item) => `minmax(0, ${item.span}fr)`).join(' '),
        }}
      >
        {phaseSpans.map((item) => (
          <div
            key={item.phase}
            className={[styles.phase, item.isCurrent ? styles.phaseCurrent : '']
              .filter(Boolean)
              .join(' ')}
          >
            <span className={styles.phaseName} title={STAGE_PHASE_LABELS[item.phase]}>
              {STAGE_PHASE_LABELS[item.phase]}
            </span>
            <span className={styles.phaseCount}>
              {item.closed} из {item.span}
            </span>
          </div>
        ))}
      </div>

      <div
        className={styles.track}
        style={
          {
            gridTemplateColumns: columns,
            // Точка схода — у текущего этапа: глубина читается от него в обе стороны.
            '--focus': `${((focus - 0.5) / ordered.length) * 100}%`,
          } as CSSProperties
        }
      >
        <span className={styles.line} aria-hidden="true" />
        <span className={styles.lineDone} style={{ width: `${donePercent}%` }} aria-hidden="true" />

        {ordered.map((stage) => {
          const isControlPoint = controlPoints.includes(stage.stageNumber)
          const deadline = stage.isOverdue
            ? 'просрочен'
            : stage.isDueSoon
              ? 'скоро срок'
              : null
          const depth = depthOf(stage, focus)
          return (
            <button
              key={stage.id}
              type="button"
              className={[
                styles.node,
                stateClass(stage),
                stage.id === current?.id ? styles.focus : '',
                stage.id === selectedStageId ? styles.selected : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ '--z': `${depth}px` } as CSSProperties}
              onClick={() => onSelect(stage.id)}
              aria-label={
                `Этап ${stage.stageNumber}: ${stage.title}. ` +
                `${STAGE_STATUS_LABELS[stage.status]}${deadline ? `, ${deadline}` : ''}` +
                `${isControlPoint ? '. Контрольная точка' : ''}` +
                `${stage.isAutoManaged ? '. Вычисляется системой' : ''}`
              }
            >
              <span className={styles.dot}>
                {stage.stageNumber}
                {isControlPoint && (
                  <span className={styles.control} aria-hidden="true">
                    <Icon name="lock" size={16} />
                  </span>
                )}
              </span>
              <span className={styles.label}>{stage.title}</span>
            </button>
          )
        })}
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={[styles.legendDot, styles.legendDone].join(' ')} />
          закрыт
        </span>
        <span className={styles.legendItem}>
          <span className={[styles.legendDot, styles.legendCurrent].join(' ')} />в работе
        </span>
        <span className={styles.legendItem}>
          <span className={[styles.legendDot, styles.legendOverdue].join(' ')} />
          просрочен
        </span>
        <span className={styles.legendItem}>
          <Icon name="lock" size={16} />
          контрольная точка: дальше не пускает, пока не завершена
        </span>
      </div>
    </div>
  )
}
