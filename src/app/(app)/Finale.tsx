'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { CooperationListItemDto } from '@/shared/contracts'
import { useCalmMotion, useReveal } from '@/ui'
import styles from './Finale.module.css'

/**
 * Финальная секция главной (решение 106, бриф v2 — 2.5): сеть SkillLink —
 * ВУЗЫ → ПРОГРАММЫ → НАВЫКИ → IT-ПРОДУКТЫ.
 *
 * Не выдуманная сеть: линии — настоящие связки «вуз → программа → продукт»
 * из данных главной; маршрут к продукту проходит через полосу навыков, где
 * стоят самые востребованные рынком навыки (дефициты) — через них и идёт
 * подготовка к продукту. Своих связей «программа — навык» в сводке нет,
 * поэтому навыки не соединены с конкретными программами: они вспыхивают,
 * когда через полосу проходит импульс.
 *
 * При появлении линии прорисовываются по очереди, затем по ним изредка бегут
 * импульсы — по одному, не всё разом. Одно SVG и CSS-анимации: прокрутку не
 * тормозит. «Уменьшить движение» и рабочий режим — статичная картинка.
 */

const HEIGHT = 380
const TOP = 56
const BOTTOM = 32
const COLUMNS = [0.1, 0.37, 0.63, 0.9]
const TITLES = ['Вузы', 'Программы', 'Навыки рынка', 'IT-продукты']
/** Больше узлов в столбце подписи не держат. */
const MAX_NODES = 7

interface Node {
  key: string
  label: string
  x: number
  y: number
}

function column(labels: string[], index: number, width: number): Node[] {
  const list = labels.slice(0, MAX_NODES)
  const span = HEIGHT - TOP - BOTTOM
  return list.map((label, i) => ({
    key: `${index}:${label}`,
    label,
    x: COLUMNS[index]! * width,
    y: TOP + (list.length === 1 ? span / 2 : (span * i) / (list.length - 1)),
  }))
}

function curve(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = (b.x - a.x) * 0.5
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}C${(a.x + dx).toFixed(1)} ${a.y.toFixed(1)} ${(b.x - dx).toFixed(1)} ${b.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
}

/** Маршрут программа → продукт через полосу навыков: изгиб к ближайшему навыку. */
function throughSkills(a: Node, b: Node, skills: Node[]): { d: string; skill: Node | null } {
  if (skills.length === 0) return { d: curve(a, b), skill: null }
  const mid = (a.y + b.y) / 2
  const skill = skills.reduce((best, node) => (Math.abs(node.y - mid) < Math.abs(best.y - mid) ? node : best))
  const via = { x: skill.x, y: skill.y }
  return { d: `${curve(a, via)}${curve(via, b).replace(/^M[^C]+/, '')}`, skill }
}

export function Finale({ cooperations, skills }: { cooperations: CooperationListItemDto[]; skills: string[] }) {
  const calm = useCalmMotion()
  const ref = useRef<HTMLDivElement>(null)
  const shown = useReveal(ref)
  const [width, setWidth] = useState(1000)

  // Поле — в пикселях блока: подписи своего размера на любой ширине.
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setWidth(Math.max(560, Math.round(element.getBoundingClientRect().width)))
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const unis = [...new Map(cooperations.map((c) => [c.universityId, c.universityShortName ?? c.universityName])).values()]
  const programs = [...new Map(cooperations.map((c) => [c.programId, c.programName])).values()]
  const products = [...new Map(cooperations.filter((c) => c.productId).map((c) => [c.productId!, c.productName!])).values()]

  const uniNodes = column(unis, 0, width)
  const programNodes = column(programs, 1, width)
  const skillNodes = column(skills, 2, width)
  const productNodes = column(products, 3, width)
  const find = (nodes: Node[], label: string) => nodes.find((node) => node.label === label)

  // Настоящие связки: вуз → программа и программа → (через навыки) → продукт.
  const routes: Array<{ key: string; d: string; kind: 'uni' | 'product'; skill: string | null }> = []
  const seen = new Set<string>()
  for (const item of cooperations) {
    const uni = find(uniNodes, item.universityShortName ?? item.universityName)
    const program = find(programNodes, item.programName)
    if (uni && program && !seen.has(`${uni.key}>${program.key}`)) {
      seen.add(`${uni.key}>${program.key}`)
      routes.push({ key: `${uni.key}>${program.key}`, d: curve(uni, program), kind: 'uni', skill: null })
    }
    const product = item.productName ? find(productNodes, item.productName) : undefined
    if (program && product && !seen.has(`${program.key}>${product.key}`)) {
      seen.add(`${program.key}>${product.key}`)
      const { d, skill } = throughSkills(program, product, skillNodes)
      routes.push({ key: `${program.key}>${product.key}`, d, kind: 'product', skill: skill?.key ?? null })
    }
  }
  const cycle = Math.max(routes.length, 4) * 1.4

  return (
    <div ref={ref} className={styles.stage} data-shown={shown || undefined} data-calm={calm || undefined}>
      <svg viewBox={`0 0 ${width} ${HEIGHT}`} className={styles.svg} role="img" aria-label="Сеть SkillLink: вузы, программы, навыки и IT-продукты">
        {TITLES.map((title, index) => (
          <text key={title} x={COLUMNS[index]! * width} y={22} textAnchor="middle" className={styles.columnTitle}>
            {title}
          </text>
        ))}
        {/* Полоса навыков — «фильтр», через который идут маршруты к продуктам. */}
        <rect
          x={COLUMNS[2]! * width - 70}
          y={TOP - 18}
          width={140}
          height={HEIGHT - TOP - BOTTOM + 36}
          rx={18}
          className={styles.skillBand}
        />

        {routes.map((route, index) => (
          <g key={route.key}>
            <path
              d={route.d}
              pathLength={1}
              className={route.kind === 'uni' ? styles.lineUni : styles.lineProduct}
              style={{ '--i': index } as CSSProperties}
            />
            {!calm && (
              <path
                d={route.d}
                pathLength={1}
                className={styles.pulse}
                style={{ animationDelay: `${1.2 + index * 1.4}s`, animationDuration: `${cycle}s` } as CSSProperties}
              />
            )}
          </g>
        ))}

        {[uniNodes, programNodes, skillNodes, productNodes].map((nodes, columnIndex) =>
          nodes.map((node, index) => (
            <g
              key={node.key}
              className={[styles.node, styles[`col${columnIndex}`]].join(' ')}
              style={{ '--n': columnIndex * 3 + index } as CSSProperties}
            >
              <circle cx={node.x} cy={node.y} r={14} className={styles.nodeHalo} />
              <circle cx={node.x} cy={node.y} r={5} className={styles.nodeCore} />
              <text
                x={node.x + (columnIndex === 3 ? -12 : 12)}
                y={node.y + 4}
                textAnchor={columnIndex === 3 ? 'end' : 'start'}
                className={styles.nodeLabel}
              >
                {node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label}
              </text>
            </g>
          )),
        )}
      </svg>
      <p className={styles.caption}>
        Линии — настоящие связки «вуз → программа → продукт». Навыки — самые востребованные рынком: через их
        закрытие программы готовят к продуктам.
      </p>
    </div>
  )
}
