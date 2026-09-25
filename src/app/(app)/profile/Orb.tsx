'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { motion, useAnimationFrame, useMotionValue, useSpring } from 'motion/react'
import type { CooperationListItemDto } from '@/shared/contracts'
import { cooperationHref, useCalmMotion } from '@/ui'
import styles from './Orb.module.css'

/**
 * Аватар-сфера с орбитой связок (решение 96, вторая версия).
 *
 * Первая версия была на CSS 3D: боковые «планеты» сплющивались в эллипсы, а
 * планета за сферой рисовалась поверх неё. Теперь положение каждой планеты
 * считается каждый кадр: задняя половина орбиты и планеты на ней рисуются
 * до сферы (тусклее и меньше), передняя — после (ярче и крупнее). Планета
 * всегда круглая, за ней тянется хвост.
 *
 * Сфера живая: внутри перетекают два пятна цветов бренда, сверху — стеклянный
 * блик, по кромке бежит градиент, вокруг дышит ореол. Сцена слегка наклоняется
 * за курсором. Планеты — связки человека (красные — где горит); наведение —
 * подпись, щелчок — связка. В рабочем режиме и при «уменьшить движение» —
 * неподвижный кадр.
 */

const SIZE = 260
const C = SIZE / 2
const ORB = 60
const ORBIT_RX = 112
const ORBIT_RY = 34
/** Наклон плоскости орбиты на экране, радианы. */
const TILT = (-14 * Math.PI) / 180
/** Оборот планеты, секунды. */
const PERIOD = 22
const TRAIL = 9

interface Planet {
  item: CooperationListItemDto
  hot: boolean
}

/** Точка орбиты: экранные координаты и глубина (1 — ближе всего к зрителю). */
function onOrbit(angle: number): { x: number; y: number; depth: number } {
  const ox = ORBIT_RX * Math.cos(angle)
  const oy = ORBIT_RY * Math.sin(angle)
  return {
    x: C + ox * Math.cos(TILT) - oy * Math.sin(TILT),
    y: C + ox * Math.sin(TILT) + oy * Math.cos(TILT),
    depth: Math.sin(angle),
  }
}

/** Дуга орбиты для половины: задней (sin < 0) или передней. */
function orbitArc(front: boolean): string {
  const points: string[] = []
  for (let i = 0; i <= 60; i++) {
    const angle = front ? (Math.PI * i) / 60 : Math.PI + (Math.PI * i) / 60
    const { x, y } = onOrbit(angle)
    points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
  }
  return points.join('')
}

const BACK_ARC = orbitArc(false)
const FRONT_ARC = orbitArc(true)

export function Orb({
  initials,
  cooperations,
}: {
  initials: string
  cooperations: CooperationListItemDto[]
}) {
  const id = useId().replace(/:/g, '')
  const router = useRouter()
  const calm = useCalmMotion()
  const [t, setT] = useState(4.2)
  const [hover, setHover] = useState<number | null>(null)
  const [fine, setFine] = useState(false)

  const planets: Planet[] = cooperations.slice(0, 8).map((item) => ({
    item,
    hot: item.progress.overdueStages > 0 || item.progress.blockedStages > 0,
  }))

  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)')
    setFine(query.matches)
  }, [])

  // Кадр за кадром — только в презентационном режиме; наведение ставит на паузу,
  // чтобы по планете можно было попасть.
  useAnimationFrame((_, delta) => {
    if (calm || hover !== null) return
    setT((value) => value + delta / 1000)
  })

  // Наклон сцены за курсором.
  const rx = useSpring(useMotionValue(0), { stiffness: 120, damping: 18 })
  const ry = useSpring(useMotionValue(0), { stiffness: 120, damping: 18 })
  const ref = useRef<HTMLDivElement>(null)
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (calm || !fine) return
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    ry.set(((event.clientX - box.left) / box.width - 0.5) * 16)
    rx.set(-((event.clientY - box.top) / box.height - 0.5) * 16)
  }
  function onPointerLeave() {
    rx.set(0)
    ry.set(0)
    setHover(null)
  }

  // Положения планет и хвостов на этот кадр.
  const placed = planets.map((planet, index) => {
    const base = (index / Math.max(planets.length, 1)) * Math.PI * 2
    const angle = base + (t / PERIOD) * Math.PI * 2
    const point = onOrbit(angle)
    const near = (point.depth + 1) / 2
    const trail = Array.from({ length: TRAIL }, (_, step) => onOrbit(angle - (step + 1) * 0.045))
    return { ...planet, index, point, near, trail }
  })
  const back = placed.filter((p) => p.point.depth < 0)
  const front = placed.filter((p) => p.point.depth >= 0)

  // Пятна внутри сферы плывут по своим кругам.
  const blobA = { x: C + Math.cos(t * 0.7) * 22, y: C + Math.sin(t * 0.9) * 18 }
  const blobB = { x: C + Math.cos(t * 0.5 + 2.4) * 24, y: C + Math.sin(t * 0.6 + 1.1) * 20 }
  const rimTurn = (t * 40) % 360

  const drawPlanet = (p: (typeof placed)[number]) => {
    const radius = 4.5 + p.near * 4.5
    const color = p.hot ? 'var(--status-danger)' : 'var(--accent-violet)'
    const label = `${p.item.universityShortName ?? p.item.universityName} — ${p.item.programName}`
    return (
      <g
        key={p.item.id}
        className={styles.planet}
        style={{ opacity: 0.45 + p.near * 0.55 }}
        onPointerEnter={() => setHover(p.index)}
        onPointerLeave={() => setHover(null)}
        onClick={() => router.push(cooperationHref(p.item.id))}
        role="link"
        aria-label={label}
      >
        {/* Хвост — кометой: тающие точки по пройденной дуге. */}
        {p.trail.map((dot, step) => (
          <circle
            key={step}
            cx={dot.x}
            cy={dot.y}
            r={radius * (1 - step / (TRAIL + 2))}
            fill={color}
            opacity={0.32 * (1 - step / TRAIL)}
          />
        ))}
        <circle cx={p.point.x} cy={p.point.y} r={radius * 2.4} fill={`url(#${id}-${p.hot ? 'hot' : 'cold'}Glow)`} />
        <circle cx={p.point.x} cy={p.point.y} r={radius} fill={`url(#${id}-${p.hot ? 'hot' : 'cold'})`} />
        {/* Мишень побольше самой планеты — попасть курсором легче. */}
        <circle cx={p.point.x} cy={p.point.y} r={Math.max(radius, 12)} fill="transparent" />
      </g>
    )
  }

  const hovered = hover !== null ? placed[hover] : null

  return (
    <div
      ref={ref}
      className={styles.stage}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <motion.svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={styles.svg}
        style={{ rotateX: rx, rotateY: ry, transformPerspective: 600 }}
        role="img"
        aria-label={`Ваши связки на орбите: ${planets.length}`}
      >
        <defs>
          {/* Объём сферы: свет сверху слева, тень снизу справа. */}
          <radialGradient id={`${id}-sphere`} cx="0.36" cy="0.3" r="0.8">
            <stop offset="0" stopColor="var(--surface-3)" />
            <stop offset="0.55" stopColor="var(--canvas)" />
            <stop offset="1" stopColor="black" />
          </radialGradient>
          <radialGradient id={`${id}-blobA`}>
            <stop offset="0" stopColor="var(--accent-violet)" stopOpacity="0.9" />
            <stop offset="1" stopColor="var(--accent-violet)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-blobB`}>
            <stop offset="0" stopColor="var(--accent-pink)" stopOpacity="0.75" />
            <stop offset="1" stopColor="var(--accent-pink)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-shine`} cx="0.35" cy="0.25" r="0.45">
            <stop offset="0" stopColor="white" stopOpacity="0.35" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-halo`}>
            <stop offset="0.55" stopColor="var(--accent-violet)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--accent-violet)" stopOpacity="0" />
          </radialGradient>
          {/* Кромка: градиент бренда, который бежит по кругу. */}
          <linearGradient id={`${id}-rim`} gradientTransform={`rotate(${rimTurn} 0.5 0.5)`}>
            <stop offset="0" stopColor="var(--accent-orange)" />
            <stop offset="0.5" stopColor="var(--accent-pink)" />
            <stop offset="1" stopColor="var(--accent-violet)" />
          </linearGradient>
          <radialGradient id={`${id}-cold`} cx="0.35" cy="0.3">
            <stop offset="0" stopColor="var(--text-accent-pale)" />
            <stop offset="1" stopColor="var(--accent-violet)" />
          </radialGradient>
          <radialGradient id={`${id}-hot`} cx="0.35" cy="0.3">
            <stop offset="0" stopColor="var(--text-danger-soft)" />
            <stop offset="1" stopColor="var(--status-danger)" />
          </radialGradient>
          <radialGradient id={`${id}-coldGlow`}>
            <stop offset="0" stopColor="var(--accent-violet)" stopOpacity="0.5" />
            <stop offset="1" stopColor="var(--accent-violet)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-hotGlow`}>
            <stop offset="0" stopColor="var(--status-danger)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--status-danger)" stopOpacity="0" />
          </radialGradient>
          <clipPath id={`${id}-clip`}>
            <circle cx={C} cy={C} r={ORB} />
          </clipPath>
        </defs>

        {/* Ореол — дышит вместе с кромкой. */}
        <circle cx={C} cy={C} r={ORB * 1.75 + Math.sin(t * 1.4) * 4} fill={`url(#${id}-halo)`} />

        {/* Задняя половина орбиты и планеты на ней — за сферой. */}
        <path d={BACK_ARC} className={styles.orbitBack} />
        {back.map(drawPlanet)}

        {/* Сфера: основа, плывущие пятна, блик, кромка. */}
        <circle cx={C} cy={C} r={ORB} fill={`url(#${id}-sphere)`} />
        <g clipPath={`url(#${id}-clip)`} className={styles.plasma}>
          <circle cx={blobA.x} cy={blobA.y} r={ORB * 0.95} fill={`url(#${id}-blobA)`} />
          <circle cx={blobB.x} cy={blobB.y} r={ORB * 0.85} fill={`url(#${id}-blobB)`} />
        </g>
        <circle cx={C} cy={C} r={ORB} fill={`url(#${id}-shine)`} />
        <circle cx={C} cy={C} r={ORB - 1.5} fill="none" stroke={`url(#${id}-rim)`} strokeWidth="3" className={styles.rim} />
        <text x={C} y={C} textAnchor="middle" dominantBaseline="central" className={styles.initials}>
          {initials}
        </text>

        {/* Передняя половина орбиты и планеты — перед сферой. */}
        <path d={FRONT_ARC} className={styles.orbitFront} />
        {front.map(drawPlanet)}
      </motion.svg>

      {/* Подпись планеты под курсором — какая это связка и что с ней. */}
      <p className={styles.caption} aria-live="polite">
        {hovered
          ? `${hovered.item.universityShortName ?? hovered.item.universityName} — ${hovered.item.programName}${
              hovered.hot ? ` · просрочено: ${hovered.item.progress.overdueStages || 'блок'}` : ' · по плану'
            }`
          : planets.length > 0
            ? 'Планеты — ваши связки'
            : ''}
      </p>
    </div>
  )
}
