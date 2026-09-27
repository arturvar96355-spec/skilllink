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
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import { STAGE_PHASE_LABELS, type CooperationListItemDto } from '@/shared/contracts'
import { WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import { createPortal } from 'react-dom'
import {
  IconButton,
  ROUTES,
  buildQuery,
  cooperationHref,
  formatDayMonth,
  formatNumber,
  formatPersonShort,
  pluralize,
  useMediaQuery,
} from '@/ui'
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
/** Панель этапа: ширина, отступ от края окна, зазор до отметки, px. */
const POP_WIDTH = 480
const POP_EDGE = 12
const POP_GAP = 12
/** До стольких связок панель показывает все; больше — первые POP_SHORT и ссылку на реестр. */
const POP_FULL = 12
const POP_SHORT = 10
/** Телефон: панель — нижний лист во всю ширину. */
const SHEET_QUERY = '(max-width: 640px)'
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

/**
 * Срок текущего этапа словами — вторая строка в панели этапа: что с ним
 * и к какому числу. `tone` — сигнал: просрочка и блок — красным, скорый срок — жёлтым.
 */
function deadlineNote(item: CooperationListItemDto): { text: string; tone: 'danger' | 'warning' | 'calm' } {
  const stage = item.currentStage
  if (!stage) return { text: 'все этапы пройдены', tone: 'calm' }
  if (stage.status === 'BLOCKED') return { text: 'этап заблокирован', tone: 'danger' }
  const days = stage.daysToDeadline
  if (stage.isOverdue) {
    const passed = days === null ? null : Math.abs(days)
    return {
      text: passed === null || passed === 0 ? 'срок вышел' : `просрочен на ${formatNumber(passed)} ${pluralize(passed, ['день', 'дня', 'дней'])}`,
      tone: 'danger',
    }
  }
  if (!stage.deadline) return { text: 'срок не задан', tone: 'calm' }
  if (stage.isDueSoon) return { text: `срок ${formatDayMonth(stage.deadline)} — скоро`, tone: 'warning' }
  if (stage.isPlanShifted) return { text: `план сдвинут, срок был ${formatDayMonth(stage.deadline)}`, tone: 'calm' }
  return { text: `срок ${formatDayMonth(stage.deadline)}`, tone: 'calm' }
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
}: {
  cooperations: CooperationListItemDto[]
  view: RouteView
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
}: {
  stage: StageMarker
  order: number
  lineY: number
  popover: Popover
}) {
  const { group, marker } = stage
  const number = group.stage
  const itemRef = useRef<HTMLLIElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  /** Панель этапа живёт в body (портал) — «внутри» для щелчка и фокуса проверяется и она. */
  const popRef = useRef<HTMLDivElement>(null)
  const listId = `${useId()}-stage`
  const isOpen = popover.open?.stage === number
  const stuck = group.stuckCount > 0

  // Список открыт — Esc закрывает его и возвращает фокус на отметку; щелчок мимо — закрывает.
  const { hide, skipFocus } = popover
  useEffect(() => {
    if (!isOpen) return
    const removeLayer = pushEscapeLayer(() => {
      hide(number)
      if (itemRef.current?.contains(document.activeElement) || popRef.current?.contains(document.activeElement)) {
        skipFocus.current = true
        triggerRef.current?.focus()
      }
    })
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node
      if (!itemRef.current?.contains(target) && !popRef.current?.contains(target)) hide(number)
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
          const next = event.relatedTarget as Node | null
          if (!event.currentTarget.contains(next) && !popRef.current?.contains(next)) popover.hide(number)
        },
      }
    : {}

  // Панель — в body, в конце документа: Tab с отметки сам бы в неё не попал.
  // Открыта — Tab ведёт в первую строку списка.
  const enterList = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || event.shiftKey || !isOpen) return
    const first = popRef.current?.querySelector<HTMLElement>('a[href]') ?? popRef.current?.querySelector<HTMLElement>('button')
    if (!first) return
    event.preventDefault()
    first.focus()
  }

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
            onKeyDown={enterList}
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
            onKeyDown={enterList}
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
          label={listLabel}
          anchorRef={triggerRef}
          itemRef={itemRef}
          pinned={popover.open?.pinned ?? false}
          popRef={popRef}
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse') popover.show(number)
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') popover.hideLater(number)
          }}
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
 * Панель этапа (решение 211): заголовок «Этап N · название», строки связок
 * целиком — вуз и программа, ответственный, срок или просрочка — без
 * прокрутки внутри. До POP_FULL связок видны все; больше — первые POP_SHORT
 * (требующие внимания идут первыми) и ссылка на реестр с отбором по этапу.
 *
 * Панель — в body, а не внутри блока: раньше её высоту ограничивал блок
 * «Активно сейчас», и список прокручивался в окошке на четыре строки.
 * Место — по окну: под отметкой, если помещается, иначе над ней; по ширине
 * сдвигается от краёв экрана. На телефоне — нижний лист во всю ширину.
 */
function StageList({
  id,
  group,
  label,
  anchorRef,
  itemRef,
  popRef,
  pinned,
  onPointerEnter,
  onPointerLeave,
  onClose,
}: {
  id: string
  group: StageGroup
  label: string
  anchorRef: RefObject<HTMLElement | null>
  itemRef: RefObject<HTMLLIElement | null>
  popRef: RefObject<HTMLDivElement | null>
  /** Открыта нажатием, а не наведением: тогда панель докручивается в окно целиком. */
  pinned: boolean
  onPointerEnter: (event: PointerEvent) => void
  onPointerLeave: (event: PointerEvent) => void
  onClose: () => void
}) {
  const isSheet = useMediaQuery(SHEET_QUERY)
  const [place, setPlace] = useState<{ left: number; top: number; width: number } | null>(null)

  // Место — в координатах страницы: панель едет вместе с прокруткой, а не висит над ней.
  useLayoutEffect(() => {
    if (isSheet) return
    const anchor = (anchorRef.current ?? itemRef.current)?.getBoundingClientRect()
    const pop = popRef.current?.getBoundingClientRect()
    if (!anchor || !pop) return
    const viewport = document.documentElement.clientWidth
    const width = Math.min(POP_WIDTH, viewport - 2 * POP_EDGE)
    const center = anchor.left + anchor.width / 2
    const left = Math.min(Math.max(center - width / 2, POP_EDGE), viewport - POP_EDGE - width)
    const below = anchor.bottom + POP_GAP
    const above = anchor.top - POP_GAP - pop.height
    const fitsBelow = below + pop.height <= window.innerHeight - POP_EDGE
    const top = fitsBelow || above < POP_EDGE ? below : above
    setPlace({ left: left + window.scrollX, top: top + window.scrollY, width })
  }, [isSheet, anchorRef, itemRef, popRef])

  // Нажали, а панель не поместилась в окно, — докрутить страницу, чтобы она была видна целиком.
  // Наведение страницу не двигает: человек только смотрит.
  useEffect(() => {
    if (!pinned || isSheet || !place) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    popRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [pinned, isSheet, place, popRef])

  const title = STAGE_TITLES.get(group.stage)
  const shown = group.count > POP_FULL ? group.items.slice(0, POP_SHORT) : group.items
  const allHref = `${ROUTES.cooperations}${buildQuery({ stage: String(group.stage) })}`

  const panel = (
    <div
      ref={popRef}
      id={id}
      role="group"
      aria-label={label}
      className={isSheet ? `${styles.pop} ${styles.popSheet}` : styles.pop}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onKeyDown={(event) => {
        // Выход из панели с клавиатуры — назад на отметку этапа: дальше Tab идёт по маршруту как обычно.
        if (event.key !== 'Tab') return
        const items = [...(popRef.current?.querySelectorAll<HTMLElement>('a[href], button') ?? [])]
        const edge = event.shiftKey ? items[0] : items.at(-1)
        if (document.activeElement !== edge) return
        event.preventDefault()
        onClose()
      }}
      style={
        isSheet
          ? undefined
          : place
            ? { left: place.left, top: place.top, width: place.width }
            : { left: 0, top: 0, width: POP_WIDTH, visibility: 'hidden' }
      }
    >
      <div className={styles.popHead}>
        <div className={styles.popHeading}>
          <span className={styles.popTitle}>
            Этап {group.stage}
            {title && <> · {title}</>}
          </span>
          <span className={styles.popStage}>
            {formatNumber(group.count)} {cooperationsWord(group.count)} сейчас на этом этапе
            {group.stuckCount > 0 && (
              <span className={styles.popAttention}>
                , {formatNumber(group.stuckCount)} {attentionWord(group.stuckCount)} внимания
              </span>
            )}
          </span>
        </div>
        <IconButton icon="close" label="Закрыть список" size="sm" onClick={onClose} />
      </div>
      <ul className={styles.popList}>
        {shown.map((item) => {
          const note = deadlineNote(item)
          const stuck = isStuck(item)
          return (
            <li key={item.id}>
              <Link href={cooperationHref(item.id)} className={styles.popLink}>
                <span className={[styles.popMark, stuck ? styles.popMarkStuck : ''].filter(Boolean).join(' ')} aria-hidden />
                <span className={styles.popText}>
                  <span className={styles.popRoute}>
                    <span className={styles.popName}>{universityLabel(item)}</span>
                    <span className={styles.popProgram}> · {item.programName}</span>
                  </span>
                  <span className={styles.popMeta}>
                    <span>{formatPersonShort(item.responsible.fullName)}</span>
                    <span className={styles.popDeadline} data-tone={note.tone}>
                      {note.text}
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      {shown.length < group.count && (
        <Link href={allHref} className={styles.popAll}>
          Все {formatNumber(group.count)} {cooperationsWord(group.count)} этапа {group.stage} →
        </Link>
      )}
    </div>
  )

  return createPortal(panel, document.body)
}
