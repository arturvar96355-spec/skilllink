'use client'

import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { usePrefersReducedMotion } from '../hooks/dom'
import { formatNumber } from '../lib/format'
import styles from './Sankey.module.css'

/**
 * Sankey (решение 79, по образцу Bklit Sankey): потоки между колонками узлов.
 * Высота узла — его величина, толщина ленты — величина потока. Одна величина —
 * один оттенок; наведение на узел или ленту подсвечивает его потоки, остальные
 * приглушаются. Значения подписаны у узлов — число видно без наведения.
 */
export interface SankeyNode {
  id: string
  label: string
  column: number
}

export interface SankeyLink {
  source: string
  target: string
  value: number
}

const WIDTH = 1000
const NODE_W = 14
const GAP = 12
const LABEL_W = 220

export function Sankey({
  nodes,
  links,
  columns,
  label,
  height = 420,
}: {
  nodes: SankeyNode[]
  links: SankeyLink[]
  /** Заголовки колонок. */
  columns: string[]
  label: string
  height?: number
}) {
  const reduced = usePrefersReducedMotion()
  const [hovered, setHovered] = useState<string | null>(null)

  const layout = useMemo(() => {
    const value = new Map<string, number>()
    for (const node of nodes) {
      const out = links.filter((link) => link.source === node.id).reduce((sum, link) => sum + link.value, 0)
      const into = links.filter((link) => link.target === node.id).reduce((sum, link) => sum + link.value, 0)
      value.set(node.id, Math.max(out, into))
    }
    const cols = columns.map((_, index) =>
      nodes.filter((node) => node.column === index && (value.get(node.id) ?? 0) > 0),
    )
    const maxTotal = Math.max(...cols.map((col) => col.reduce((sum, node) => sum + value.get(node.id)!, 0)))
    const maxCount = Math.max(...cols.map((col) => col.length))
    const scale = (height - GAP * (maxCount - 1)) / Math.max(maxTotal, 1)
    const colX = columns.map(
      (_, index) => LABEL_W + ((WIDTH - LABEL_W * 2 - NODE_W) * index) / Math.max(columns.length - 1, 1),
    )
    const box = new Map<string, { x: number; y: number; h: number; out: number; into: number }>()
    cols.forEach((col, index) => {
      const total = col.reduce((sum, node) => sum + value.get(node.id)! * scale, 0) + GAP * (col.length - 1)
      let y = (height - total) / 2
      for (const node of col) {
        const h = value.get(node.id)! * scale
        box.set(node.id, { x: colX[index]!, y, h, out: y, into: y })
        y += h + GAP
      }
    })
    const bands = links
      .filter((link) => box.has(link.source) && box.has(link.target))
      .map((link) => {
        const a = box.get(link.source)!
        const b = box.get(link.target)!
        const w = link.value * scale
        const y1 = a.out
        const y2 = b.into
        a.out += w
        b.into += w
        const x1 = a.x + NODE_W
        const x2 = b.x
        const mx = (x1 + x2) / 2
        const d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2} L${x2},${y2 + w} C${mx},${y2 + w} ${mx},${y1 + w} ${x1},${y1 + w} Z`
        return { ...link, d }
      })
    return { value, box, bands, colX }
  }, [nodes, links, columns, height])

  const lit = (link: SankeyLink) => hovered === null || hovered === link.source || hovered === link.target

  return (
    <figure className={styles.root} aria-label={label}>
      <div className={styles.heads} aria-hidden>
        {columns.map((column, index) => (
          <span key={column} style={{ left: `${((layout.colX[index]! + NODE_W / 2) / WIDTH) * 100}%` }}>
            {column}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className={styles.svg}>
        {layout.bands.map((band, index) => (
          <motion.path
            key={`${band.source}-${band.target}`}
            d={band.d}
            className={`${styles.band} ${lit(band) ? '' : styles.dim}`}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: reduced ? 0 : 0.3 + index * 0.03, duration: 0.5 }}
            onPointerEnter={() => setHovered(band.source)}
            onPointerLeave={() => setHovered(null)}
          >
            <title>{`${nodes.find((n) => n.id === band.source)?.label} → ${nodes.find((n) => n.id === band.target)?.label}: ${formatNumber(band.value)}`}</title>
          </motion.path>
        ))}
        {nodes.map((node) => {
          const box = layout.box.get(node.id)
          if (!box) return null
          const right = node.column === columns.length - 1
          const left = node.column === 0
          return (
            <g
              key={node.id}
              className={styles.node}
              tabIndex={0}
              aria-label={`${node.label}: ${formatNumber(layout.value.get(node.id) ?? 0)}`}
              onPointerEnter={() => setHovered(node.id)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(node.id)}
              onBlur={() => setHovered(null)}
            >
              <motion.rect
                x={box.x}
                y={box.y}
                width={NODE_W}
                height={Math.max(box.h, 2)}
                rx={3}
                className={styles.bar}
                initial={reduced ? false : { scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                style={{ transformOrigin: `${box.x}px ${box.y + box.h / 2}px`, transformBox: 'view-box' }}
              />
              <text
                x={left ? box.x - 10 : right ? box.x + NODE_W + 10 : box.x + NODE_W + 8}
                y={box.y + box.h / 2}
                className={styles.label}
                textAnchor={left ? 'end' : 'start'}
                dominantBaseline="middle"
              >
                {node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label}
                <tspan className={styles.value}> {formatNumber(layout.value.get(node.id) ?? 0)}</tspan>
              </text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
