'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { useCalmMotion } from '../hooks/ui-mode'
import { pushEscapeLayer } from '../hooks/escape-stack'
import { IconButton } from '../primitives/IconButton'
import { RUSSIA_PATH, RUSSIA_VIEWBOX, projectRussia } from './russia-map'
import { clusterPoints, clusterTitle, placeFloating, placeLabels, type MapCluster } from './map-clusters'
import styles from './RussiaMap.module.css'

/**
 * Карта России (решение 79; вторая версия — решение 123; кучки — решение 198).
 *
 * Настоящая география (Natural Earth, проекция Альберса): материк с тонким
 * контуром и сеткой, вузы — точками (ярче — где связки в работе). От «центра»
 * (`hub`, для главной — Москва, ИТ-Школа РТК) к вузам идут тонкие дуги; по ним
 * по очереди пробегает тихий импульс.
 *
 * Вузы одного города или ближе ~80 км (Казань и Иннополис) — одна точка-кучка
 * с числом вузов и подписью «Казань · 2 вуза»; щелчок или Enter раскрывает
 * рядом список вузов кучки со ссылками, Esc или щелчок мимо — закрывает.
 * Одиночный вуз — ссылка на его страницу. Подписи, которым не хватило места,
 * прячутся (сначала — у вузов с меньшим числом связок); имя остаётся в
 * подсказке и в `aria-label`. Подписи и точки — в пикселях экрана, а не поля:
 * на телефоне они не мельчают, а лишние подписи уходят.
 * В рабочем режиме и при «уменьшить движение» — без импульсов и пульсации.
 */
export interface MapPoint {
  key: string
  label: string
  lat: number
  lon: number
  value: number
  detail: string
  href: string
  /** Город — по нему вузы собираются в кучку. Нет — только по расстоянию. */
  city?: string
  /** Есть связки в работе — точка ярче и с дугой от центра. */
  active?: boolean
}

export interface MapHub {
  label: string
  lat: number
  lon: number
}

type Placed = MapPoint & { x: number; y: number }

/** Сетка: параллели каждые 10°, меридианы каждые 20° — в пределах России. */
function graticule(): string {
  const lines: string[] = []
  const line = (points: Array<[number, number]>) => {
    const projected = points.map(([lat, lon]) => projectRussia(lat, lon))
    lines.push(projected.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(''))
  }
  for (let lat = 45; lat <= 75; lat += 10) {
    line(Array.from({ length: 41 }, (_, i) => [lat, 20 + i * 4.5] as [number, number]))
  }
  for (let lon = 30; lon <= 190; lon += 20) {
    line(Array.from({ length: 21 }, (_, i) => [40 + i * 1.8, lon] as [number, number]))
  }
  return lines.join('')
}

const GRID = graticule()

/** Дуга от центра к точке: изгиб вверх, пропорциональный длине — как маршрут. */
function arc(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  return `M${from.x.toFixed(1)} ${from.y.toFixed(1)}Q${mx.toFixed(1)} ${(my - length * 0.28).toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`
}

/** Кегль подписи на экране — `--text-label-size`; ширина знака — с запасом под кириллицу. */
const LABEL_PX = 12
const CHAR_RATIO = 0.68
/** Длиннее подпись на карте не бывает: полное имя — в подсказке. */
const LABEL_MAX_CHARS = 16
/** Наименьшая точка и мишень на экране: точку видно, по ней попадает палец. */
const DOT_MIN_PX = 4
const CLUSTER_MIN_PX = 8
const HIT_MIN_PX = 20
/** Ширина карты до первого замера — примерно блок на 1440. */
const DEFAULT_WIDTH = 760

const shorten = (text: string) => (text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS - 1)}…` : text)

export function RussiaMap({ points, label, hub }: { points: MapPoint[]; label: string; hub?: MapHub }) {
  const reduced = useCalmMotion()
  const id = useId().replace(/:/g, '')
  const mapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [hovered, setHovered] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    const element = mapRef.current
    if (!element) return
    const measure = () => {
      const next = Math.round(element.getBoundingClientRect().width)
      if (next > 0) setWidth(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  /** Пиксели экрана → единицы поля карты. */
  const scale = width / RUSSIA_VIEWBOX.width
  const units = (px: number) => px / scale
  const height = RUSSIA_VIEWBOX.height * scale

  const placed: Placed[] = points.map((point) => ({
    ...point,
    ...projectRussia(point.lat, point.lon),
  }))
  const clusters = clusterPoints(placed)
  const center = hub ? { ...hub, ...projectRussia(hub.lat, hub.lon) } : null
  const links = center
    ? clusters.filter((cluster) => cluster.active && Math.hypot(cluster.x - center.x, cluster.y - center.y) > 8)
    : []
  const max = Math.max(1, ...clusters.map((cluster) => cluster.value))
  const halo = (value: number) => Math.max(5 + 8 * Math.sqrt(value / max), units(DOT_MIN_PX) * 1.2)
  const core = (cluster: MapCluster<Placed>) =>
    Math.max((5 + 8 * Math.sqrt(cluster.value / max)) * 0.62, units(cluster.members.length > 1 ? CLUSTER_MIN_PX : DOT_MIN_PX))
  // Мишень под палец — не дальше середины пути до соседней точки: иначе на
  // телефоне соседняя мишень перекрывала кучку, и касание открывало чужой вуз.
  const hitRadius = (cluster: MapCluster<Placed>) => {
    const nearest = Math.min(
      Infinity,
      ...clusters.filter((other) => other !== cluster).map((other) => Math.hypot(other.x - cluster.x, other.y - cluster.y)),
    )
    return Math.max(core(cluster), Math.min(Math.max(core(cluster) * 1.6, units(HIT_MIN_PX)), nearest / 2))
  }
  // Кучки рисуются последними — поверх одиночных точек.
  const drawOrder = [...clusters].sort((a, b) => Number(a.members.length > 1) - Number(b.members.length > 1))
  const labelSize = units(LABEL_PX)
  const labels = placeLabels(
    clusters.map((cluster) => ({
      key: cluster.key,
      text: shorten(clusterTitle(cluster)),
      x: cluster.x,
      y: cluster.y,
      r: core(cluster) + units(2),
      // Сначала подписываются кучки и вузы со связками в работе, дальше — по числу связок.
      weight: (cluster.active ? 1000 : 0) + cluster.value,
    })),
    { size: labelSize, charWidth: labelSize * CHAR_RATIO },
    RUSSIA_VIEWBOX,
  )

  const hoveredCluster = clusters.find((cluster) => cluster.key === hovered && cluster.key !== open) ?? null
  const openCluster = clusters.find((cluster) => cluster.key === open) ?? null

  // Подсказка и список кучки — HTML над картой, место считается по их размеру.
  const tipRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [tipAt, setTipAt] = useState<{ left: number; top: number } | null>(null)
  const [popAt, setPopAt] = useState<{ left: number; top: number } | null>(null)
  const field = { width, height }
  useLayoutEffect(() => {
    const tip = tipRef.current
    if (!hoveredCluster || !tip) return setTipAt(null)
    const at = placeFloating(
      { x: hoveredCluster.x * scale, y: hoveredCluster.y * scale },
      { width: tip.offsetWidth, height: tip.offsetHeight },
      field,
    )
    setTipAt((current) => (current && current.left === at.left && current.top === at.top ? current : at))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredCluster?.key, scale, width])
  useLayoutEffect(() => {
    const pop = popRef.current
    if (!openCluster || !pop) return setPopAt(null)
    const box = mapRef.current?.getBoundingClientRect()
    if (!box) return setPopAt(null)
    const place = placeFloating(
      { x: openCluster.x * scale, y: openCluster.y * scale },
      { width: pop.offsetWidth, height: pop.offsetHeight },
      field,
      18,
    )
    // Окно — в body (см. разметку), поэтому место — в координатах документа.
    const at = {
      left: box.left + window.scrollX + place.left,
      top: box.top + window.scrollY + place.top,
    }
    setPopAt((current) => (current && current.left === at.left && current.top === at.top ? current : at))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCluster?.key, scale, width])

  const trigger = useCallback(
    (key: string) => mapRef.current?.querySelector<SVGElement>(`[data-cluster="${CSS.escape(key)}"]`),
    [],
  )
  const close = useCallback(
    (refocus: boolean) => {
      if (open && refocus) trigger(open)?.focus()
      setOpen(null)
    },
    [open, trigger],
  )

  // Открытый список: фокус на первую ссылку; Esc — закрыть и вернуть фокус
  // на кучку; щелчок мимо списка и кучки — закрыть.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => popRef.current?.querySelector<HTMLElement>('a[href]')?.focus())
    const removeLayer = pushEscapeLayer(() => close(true))
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target || popRef.current?.contains(target) || target.closest(`[data-cluster="${CSS.escape(open)}"]`)) return
      close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      cancelAnimationFrame(frame)
      removeLayer()
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, close])

  const hoverProps = (key: string) => ({
    onPointerEnter: () => setHovered(key),
    onPointerLeave: () => setHovered((current) => (current === key ? null : current)),
    onFocus: () => setHovered(key),
    onBlur: () => setHovered((current) => (current === key ? null : current)),
  })

  const toggle = (key: string) => setOpen((current) => (current === key ? null : key))
  const onClusterKey = (key: string) => (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggle(key)
    }
  }

  return (
    <figure className={styles.root} aria-label={label}>
      <div className={styles.map} ref={mapRef}>
        <svg
          viewBox={`0 0 ${RUSSIA_VIEWBOX.width} ${RUSSIA_VIEWBOX.height}`}
          className={styles.svg}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id={`${id}-land`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className={styles.landTop} />
              <stop offset="1" className={styles.landBottom} />
            </linearGradient>
            <clipPath id={`${id}-clip`}>
              <path d={RUSSIA_PATH} />
            </clipPath>
            {/* Мягкое свечение контура: размытая копия под чёткой линией, узкая. */}
            <filter id={`${id}-glow`} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <radialGradient id={`${id}-dot`}>
              <stop offset="0" className={styles.dotCore} />
              <stop offset="0.45" className={styles.dotMid} />
              <stop offset="1" className={styles.dotEdge} />
            </radialGradient>
          </defs>

          {/* Материк: глубина градиентом, сетка внутри, тонкий контур. */}
          <path d={RUSSIA_PATH} fill={`url(#${id}-land)`} />
          <path d={GRID} className={styles.grid} clipPath={`url(#${id}-clip)`} />
          <path d={RUSSIA_PATH} className={styles.coast} filter={`url(#${id}-glow)`} />

          {/* Связи центра с вузами: тонкие дуги, импульс — по одной за раз. */}
          {center &&
            links.map((cluster, index) => {
              const d = arc(center, cluster)
              const lit = hovered === cluster.key || open === cluster.key
              return (
                <g key={`link-${cluster.key}`} className={lit ? styles.linkLit : styles.link}>
                  <path d={d} className={styles.linkLine} />
                  {!reduced && (
                    <path
                      d={d}
                      className={styles.linkPulse}
                      pathLength={1}
                      style={{
                        animationDelay: `${index * 2.2}s`,
                        animationDuration: `${Math.max(links.length, 3) * 2.2}s`,
                      }}
                    />
                  )}
                </g>
              )
            })}

          {center && (
            <g className={styles.hub}>
              <title>{hub?.label}</title>
              {!reduced && <circle cx={center.x} cy={center.y} r={units(10)} className={styles.hubPulse} />}
              <circle cx={center.x} cy={center.y} r={units(9)} className={styles.hubHalo} />
              <circle cx={center.x} cy={center.y} r={units(3.5)} className={styles.hubCore} />
            </g>
          )}

          {drawOrder.map((cluster) => {
            const index = clusters.indexOf(cluster)
            const r = core(cluster)
            const dim = !cluster.active
            const spot = labels.get(cluster.key)
            const many = cluster.members.length > 1
            const lit = hovered === cluster.key || open === cluster.key
            const className = [styles.point, many ? styles.cluster : '', dim ? styles.pointDim : '', lit ? styles.pointLit : '']
              .filter(Boolean)
              .join(' ')
            const shapes = (
              <>
                {/* Прозрачная мишень: на телефоне точка мала, а палец — нет. */}
                <circle cx={cluster.x} cy={cluster.y} r={hitRadius(cluster)} className={styles.hit} />
                <circle
                  cx={cluster.x}
                  cy={cluster.y}
                  r={halo(cluster.value) * 2.2}
                  fill={`url(#${id}-dot)`}
                  className={styles.halo}
                />
                {many && <circle cx={cluster.x} cy={cluster.y} r={r + units(3)} className={styles.stack} />}
                <motion.circle
                  cx={cluster.x}
                  cy={cluster.y}
                  r={r}
                  className={styles.dot}
                  initial={reduced ? false : { scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{
                    delay: reduced ? 0 : 0.3 + index * 0.08,
                    type: 'spring',
                    stiffness: 260,
                    damping: 20,
                  }}
                  style={{
                    transformOrigin: `${cluster.x}px ${cluster.y}px`,
                    transformBox: 'view-box',
                  }}
                />
                {many && (
                  <text
                    x={cluster.x}
                    y={cluster.y}
                    dy="0.35em"
                    textAnchor="middle"
                    className={styles.count}
                    style={{ fontSize: units(LABEL_PX - 1) }}
                  >
                    {cluster.members.length}
                  </text>
                )}
                {spot && (
                  <text
                    x={spot.x}
                    y={spot.y}
                    textAnchor={spot.anchor}
                    className={styles.label}
                    style={{ fontSize: labelSize, strokeWidth: units(3) }}
                  >
                    {spot.text}
                  </text>
                )}
              </>
            )

            if (!many) {
              const point = cluster.members[0]!
              return (
                <Link
                  key={cluster.key}
                  href={point.href}
                  aria-label={`${point.label}: ${point.detail}`}
                  data-cluster={cluster.key}
                  className={className}
                  {...hoverProps(cluster.key)}
                >
                  {shapes}
                </Link>
              )
            }
            const title = clusterTitle(cluster)
            return (
              <g
                key={cluster.key}
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                aria-expanded={open === cluster.key}
                aria-label={`${title}: ${cluster.members.map((member) => member.label).join(', ')}. Открыть список`}
                data-cluster={cluster.key}
                className={className}
                onClick={() => toggle(cluster.key)}
                onKeyDown={onClusterKey(cluster.key)}
                {...hoverProps(cluster.key)}
              >
                {shapes}
              </g>
            )
          })}
        </svg>

        {hoveredCluster && (
          <div
            ref={tipRef}
            className={styles.tooltip}
            role="tooltip"
            style={tipAt ? { left: tipAt.left, top: tipAt.top } : { visibility: 'hidden' }}
          >
            {hoveredCluster.members.length > 1 ? (
              <>
                <span className={styles.tooltipTitle}>{clusterTitle(hoveredCluster)}</span>
                <span className={styles.tooltipText}>
                  {hoveredCluster.members.map((member) => member.label).join(', ')}. Щелчок — список вузов
                </span>
              </>
            ) : (
              <>
                <span className={styles.tooltipTitle}>{hoveredCluster.members[0]!.label}</span>
                <span className={styles.tooltipText}>{hoveredCluster.members[0]!.detail}</span>
              </>
            )}
          </div>
        )}

        {/*
         * Список кучки — в body: блок карты на главной собирается анимацией
         * (своя стопка слоёв), и окно, выходящее за карту вниз, уходило под
         * следующий блок страницы.
         */}
        {openCluster &&
          createPortal(
            <div
              ref={popRef}
              className={styles.pop}
              role="dialog"
              aria-label={clusterTitle(openCluster)}
              style={popAt ? { left: popAt.left, top: popAt.top } : { visibility: 'hidden' }}
              onBlur={(event) => {
                // Фокус ушёл из списка (Tab за последнюю ссылку) — список закрывается.
                const next = event.relatedTarget as Node | null
                if (next && !event.currentTarget.contains(next)) close(false)
              }}
            >
              <div className={styles.popHead}>
                <span className={styles.popTitle}>{clusterTitle(openCluster)}</span>
                <IconButton icon="close" label="Закрыть список" size="sm" onClick={() => close(true)} />
              </div>
              <ul className={styles.popList}>
                {openCluster.members.map((member) => (
                  <li key={member.key}>
                    <Link href={member.href} className={styles.popLink}>
                      <span className={styles.popName}>{member.label}</span>
                      <span className={styles.popDetail}>{member.detail}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )}
      </div>
    </figure>
  )
}
