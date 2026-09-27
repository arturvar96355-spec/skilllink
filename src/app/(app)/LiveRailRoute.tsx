'use client'

import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import { STAGE_PHASE_LABELS, type CooperationListItemDto } from '@/shared/contracts'
import { WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import { IconButton, cooperationHref, formatNumber, pluralize } from '@/ui'
import { pushEscapeLayer } from '@/ui/hooks/escape-stack'
import {
  TOTAL_STAGES,
  countLabel,
  countText,
  estimateTextWidth,
  groupByStage,
  isStuck,
  routeLayout,
  universityLabel,
  type RouteView,
  type StageGroup,
  type StageMarker,
} from './route-rail'
import styles from './LiveRailRoute.module.css'

/** Ширина дорожки до первого замера — примерно блок на 1440. */
const DEFAULT_WIDTH = 1100
/** Список этапа: ширина, отступ от края блока, зазор до отметки, наименьшая высота, px. */
const POP_WIDTH = 360
const POP_EDGE = 12
const POP_GAP = 10
const POP_MIN_HEIGHT = 140
/** Пауза перед закрытием списка, когда указатель ушёл: успеть дойти до списка. */
const CLOSE_DELAY = 160

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

const STAGE_TITLES = new Map(WORKFLOW_STAGES.map((stage) => [stage.number, stage.title]))

const cooperationsWord = (count: number) => pluralize(count, ['связка', 'связки', 'связок'])
const attentionWord = (count: number) => pluralize(count, ['требует', 'требуют', 'требуют'])

function stuckNote(item: CooperationListItemDto): string | null {
  if (item.progress.overdueStages > 0) return 'просрочка'
  if (item.progress.blockedStages > 0) return 'заблокирован'
  return null
}

function dotLabel(item: CooperationListItemDto, stage: number): string {
  return `${universityLabel(item)}, ${item.programName}: этап ${stage} из ${TOTAL_STAGES}${isStuck(item) ? ', требует внимания' : ''}`
}

function dotTitle(item: CooperationListItemDto, stage: number): string {
  return `${universityLabel(item)} — ${item.programName}\nЭтап ${stage}: ${item.currentStage?.title ?? STAGE_TITLES.get(stage) ?? ''}`
}

/** Ширина текста подписи — настоящим шрифтом дорожки, после монтирования. */
function useTextMeasure(trackRef: RefObject<HTMLDivElement | null>) {
  const [measure, setMeasure] = useState<(text: string) => number>(() => estimateTextWidth)
  useEffect(() => {
    const track = trackRef.current
    const context = document.createElement('canvas').getContext('2d')
    if (!track || !context) return
    const style = getComputedStyle(track)
    const size = style.getPropertyValue('--text-caption-size').trim() || '12px'
    context.font = `500 ${size} ${style.fontFamily}`
    const cache = new Map<string, number>()
    setMeasure(() => (text: string) => {
      const known = cache.get(text)
      if (known !== undefined) return known
      const width = context.measureText(text).width
      cache.set(text, width)
      return width
    })
  }, [trackRef])
  return measure
}

function useTrackWidth(trackRef: RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const read = () => {
      const next = Math.round(track.getBoundingClientRect().width)
      if (next > 0) setWidth(next)
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(track)
    return () => observer.disconnect()
  }, [trackRef])
  return width
}

/**
 * Маршрут из четырнадцати этапов со связками в работе (решение 202).
 *
 * У этапа одно место на шкале. Вид — проп `view`:
 * - `count` (А, по умолчанию): одна точка на этап; больше одной связки — точка
 *   с числом внутри, подпись «КубГТУ и ещё 11»; наведение, фокус или нажатие
 *   открывают список связок этапа со ссылками;
 * - `column` (Б): точки этапа столбиком вверх, до пяти, выше — «+N» (открывает
 *   тот же список); подпись — вуз верхней точки.
 * Требующие внимания — сигнальным тоном. Подписи, которым не хватило места,
 * прячутся, у каждой отметки — `aria-label`.
 */
export function LiveRailRoute({
  cooperations,
  view,
  frameRef,
}: {
  cooperations: CooperationListItemDto[]
  view: RouteView
  /** Рамка блока: список этапа не выходит за неё. */
  frameRef: RefObject<HTMLElement | null>
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const width = useTrackWidth(trackRef)
  const measure = useTextMeasure(trackRef)
  const groups = useMemo(() => groupByStage(cooperations), [cooperations])
  const layout = useMemo(() => routeLayout(groups, view, width, measure), [groups, view, width, measure])

  const popover = useStagePopover()

  return (
    <div
      ref={trackRef}
      className={styles.track}
      style={{ '--line-y': `${layout.lineY}px`, '--drop': `${layout.drop}px` } as CSSProperties}
    >
      <span className={styles.line} aria-hidden />
      {Array.from({ length: TOTAL_STAGES }, (_, index) => (
        <span
          key={index}
          className={styles.tick}
          style={{ left: `${(((index + 0.5) / TOTAL_STAGES) * 100).toFixed(3)}%`, '--t': index } as CSSProperties}
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

      {layout.labels.map((label) => {
        const group = groups.find((item) => item.stage === label.key)!
        const cut = view === 'count' && group.count > 1 && label.text !== group.leadName
        return (
          <span
            key={label.key}
            className={styles.stageLabel}
            style={{ left: `${(label.left / width) * 100}%`, top: label.top } as CSSProperties}
            aria-hidden
          >
            {cut ? (
              <>
                {group.leadName}
                <span className={styles.stageMore}>{label.text.slice(group.leadName.length)}</span>
              </>
            ) : (
              label.text
            )}
          </span>
        )
      })}

      <ul className={styles.stages} aria-label="Связки в работе на маршруте из 14 этапов">
        {layout.stages.map((stage, order) => (
          <StageItem
            key={stage.group.stage}
            stage={stage}
            order={order}
            lineY={layout.lineY}
            popover={popover}
            frameRef={frameRef}
          />
        ))}
      </ul>
    </div>
  )
}

type Popover = ReturnType<typeof useStagePopover>

/**
 * Открытый список этапа — один на маршрут. Наведение мышью открывает его
 * предпросмотром (уходит вместе с указателем), фокус с клавиатуры — тоже
 * (Tab ведёт прямо в ссылки списка), нажатие закрепляет. Esc, щелчок мимо
 * и уход фокуса — закрывают.
 */
function useStagePopover() {
  const [open, setOpen] = useState<{ stage: number; pinned: boolean } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  /** После Esc фокус возвращается на точку — и не должен снова открыть список. */
  const skipFocus = useRef(false)

  const cancelClose = useCallback(() => window.clearTimeout(timer.current), [])
  const show = useCallback(
    (stage: number) => {
      cancelClose()
      setOpen((current) => (current?.stage === stage ? current : { stage, pinned: false }))
    },
    [cancelClose],
  )
  const hide = useCallback((stage: number) => {
    setOpen((current) => (current?.stage === stage ? null : current))
  }, [])
  const toggle = useCallback(
    (stage: number) => {
      cancelClose()
      setOpen((current) => (current?.stage === stage && current.pinned ? null : { stage, pinned: true }))
    },
    [cancelClose],
  )
  const hideLater = useCallback(
    (stage: number) => {
      cancelClose()
      timer.current = window.setTimeout(
        () => setOpen((current) => (current?.stage === stage && !current.pinned ? null : current)),
        CLOSE_DELAY,
      )
    },
    [cancelClose],
  )

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return { open, show, hide, hideLater, toggle, skipFocus, close: () => setOpen(null) }
}

function StageItem({
  stage,
  order,
  lineY,
  popover,
  frameRef,
}: {
  stage: StageMarker
  order: number
  lineY: number
  popover: Popover
  frameRef: RefObject<HTMLElement | null>
}) {
  const { group, marker } = stage
  const number = group.stage
  const itemRef = useRef<HTMLLIElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listId = `${useId()}-stage`
  const isOpen = popover.open?.stage === number
  const stuck = group.stuckCount > 0

  // Список открыт — Esc закрывает его и возвращает фокус на отметку; щелчок мимо — закрывает.
  const { hide, skipFocus } = popover
  useEffect(() => {
    if (!isOpen) return
    const removeLayer = pushEscapeLayer(() => {
      hide(number)
      if (itemRef.current?.contains(document.activeElement)) {
        skipFocus.current = true
        triggerRef.current?.focus()
      }
    })
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!itemRef.current?.contains(event.target as Node)) hide(number)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      removeLayer()
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [isOpen, number, hide, skipFocus])

  const hasList = marker.view === 'count' ? group.count > 1 : marker.more > 0
  const listHandlers = hasList
    ? {
        onPointerEnter: (event: PointerEvent) => {
          if (event.pointerType === 'mouse') popover.show(number)
        },
        onPointerLeave: (event: PointerEvent) => {
          if (event.pointerType === 'mouse') popover.hideLater(number)
        },
        onFocus: () => {
          if (skipFocus.current) {
            skipFocus.current = false
            return
          }
          popover.show(number)
        },
        onBlur: (event: FocusEvent) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) popover.hide(number)
        },
      }
    : {}

  const listLabel = `Этап ${number} из ${TOTAL_STAGES}: ${formatNumber(group.count)} ${cooperationsWord(group.count)}${
    stuck ? `, ${formatNumber(group.stuckCount)} ${attentionWord(group.stuckCount)} внимания` : ''
  }`

  return (
    <li
      ref={itemRef}
      className={[styles.stage, isOpen ? styles.stageOpen : ''].filter(Boolean).join(' ')}
      style={{ left: `${(((number - 0.5) / TOTAL_STAGES) * 100).toFixed(3)}%`, '--i': order } as CSSProperties}
      {...listHandlers}
    >
      {marker.view === 'count' ? (
        group.count === 1 ? (
          <Link
            href={cooperationHref(group.items[0]!.id)}
            className={[styles.dot, stuck ? styles.stuck : ''].filter(Boolean).join(' ')}
            aria-label={dotLabel(group.items[0]!, number)}
            title={dotTitle(group.items[0]!, number)}
          />
        ) : (
          <button
            ref={triggerRef}
            type="button"
            className={[styles.counter, stuck ? styles.counterStuck : ''].filter(Boolean).join(' ')}
            style={
              {
                '--size': `${marker.size}px`,
                '--stuck': `${((group.stuckCount / group.count) * 100).toFixed(1)}%`,
              } as CSSProperties
            }
            aria-expanded={isOpen}
            aria-controls={isOpen ? listId : undefined}
            aria-label={`${listLabel}. ${countLabel(group)}. Показать список`}
            onClick={() => popover.toggle(number)}
          >
            <span aria-hidden>{countText(group.count)}</span>
          </button>
        )
      ) : (
        <>
          {marker.dots.map(({ item, y }, k) => (
            <Link
              key={item.id}
              href={cooperationHref(item.id)}
              className={[styles.dot, styles.columnDot, isStuck(item) ? styles.stuck : ''].filter(Boolean).join(' ')}
              style={{ '--dy': `${y - lineY}px`, '--k': k } as CSSProperties}
              aria-label={dotLabel(item, number)}
              title={dotTitle(item, number)}
            />
          ))}
          {marker.more > 0 && marker.moreTop !== null && (
            <button
              ref={triggerRef}
              type="button"
              className={styles.more}
              style={{ '--dy': `${marker.moreTop - lineY}px`, '--k': marker.dots.length } as CSSProperties}
              aria-expanded={isOpen}
              aria-controls={isOpen ? listId : undefined}
              aria-label={`${listLabel}. Ещё ${formatNumber(marker.more)} — показать все`}
              onClick={() => popover.toggle(number)}
            >
              +{formatNumber(marker.more)}
            </button>
          )}
        </>
      )}

      {isOpen && (
        <StageList
          id={listId}
          group={group}
          rise={stage.rise}
          label={listLabel}
          frameRef={frameRef}
          itemRef={itemRef}
          onClose={() => {
            popover.hide(number)
            skipFocus.current = true
            triggerRef.current?.focus()
          }}
        />
      )}
    </li>
  )
}

/**
 * Список связок этапа — над отметкой, внутри рамки блока: по ширине сдвигается
 * от краёв, по высоте не выше верха блока (дальше — прокрутка списка).
 */
function StageList({
  id,
  group,
  rise,
  label,
  frameRef,
  itemRef,
  onClose,
}: {
  id: string
  group: StageGroup
  rise: number
  label: string
  frameRef: RefObject<HTMLElement | null>
  itemRef: RefObject<HTMLLIElement | null>
  onClose: () => void
}) {
  const [place, setPlace] = useState<{ left: number; width: number; maxHeight: number } | null>(null)

  // Место — по рамке блока и точке этапа (элемент списка стоит на линии, в середине этапа).
  useLayoutEffect(() => {
    const frame = frameRef.current?.getBoundingClientRect()
    const anchor = itemRef.current?.getBoundingClientRect()
    if (!frame || !anchor) return
    const width = Math.min(POP_WIDTH, frame.width - 2 * POP_EDGE)
    const wanted = anchor.left - width / 2
    const left = Math.min(Math.max(wanted, frame.left + POP_EDGE), frame.right - POP_EDGE - width) - anchor.left
    const maxHeight = Math.max(POP_MIN_HEIGHT, anchor.top - rise - POP_GAP - frame.top - POP_EDGE)
    setPlace({ left, width, maxHeight })
  }, [frameRef, itemRef, rise])

  const title = STAGE_TITLES.get(group.stage)

  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      className={styles.pop}
      style={
        {
          '--rise': `${rise}px`,
          ...(place ? { left: place.left, width: place.width, maxHeight: place.maxHeight } : { visibility: 'hidden' }),
        } as unknown as CSSProperties
      }
    >
      <div className={styles.popHead}>
        <div className={styles.popHeading}>
          <span className={styles.popTitle}>
            Этап {group.stage} · {formatNumber(group.count)} {cooperationsWord(group.count)}
            {group.stuckCount > 0 && (
              <span className={styles.popAttention}>
                , {formatNumber(group.stuckCount)} {attentionWord(group.stuckCount)} внимания
              </span>
            )}
          </span>
          {title && <span className={styles.popStage}>{title}</span>}
        </div>
        <IconButton icon="close" label="Закрыть список" size="sm" onClick={onClose} />
      </div>
      <ul className={styles.popList}>
        {group.items.map((item) => {
          const note = stuckNote(item)
          return (
            <li key={item.id}>
              <Link
                href={cooperationHref(item.id)}
                className={styles.popLink}
                title={`${universityLabel(item)} — ${item.programName}`}
              >
                <span className={[styles.popMark, note ? styles.popMarkStuck : ''].filter(Boolean).join(' ')} aria-hidden />
                <span className={styles.popText}>
                  <span className={styles.popName}>{universityLabel(item)}</span>
                  <span className={styles.popProgram}> · {item.programName}</span>
                </span>
                {note && <span className={styles.popNote}>{note}</span>}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
