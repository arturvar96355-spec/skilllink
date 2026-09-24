'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import {
  COOPERATION_STATUS_LABELS,
  PROGRAM_LEVEL_LABELS,
  type CooperationListItemDto,
  type CooperationStatus,
  type ProgramListItemDto,
} from '@/shared/contracts'
import {
  EmptyState,
  SkeletonLines,
  buildQuery,
  cooperationHref,
  formatNumber,
  productHref,
  programHref,
  useCalmMotion,
  useResource,
} from '@/ui'
import styles from './UniversityGraph.module.css'

/**
 * Граф связей вуза (решение 79, по образцу Melius «Node Explainer»).
 *
 * Суть SkillLink одной картинкой: вуз → его программы → IT-продукты, а связка —
 * изогнутая линия от программы к продукту, цвета её статуса, с отметкой этапа
 * посередине. Сверху — вкладки-категории по статусу связки. Узлы появляются
 * колонками слева направо, линии прорисовываются следом; наведение на узел
 * подсвечивает его линии. Узлы — ссылки на программу, продукт и связку.
 *
 * Раскладка считается, а не измеряется: колонки по ширине контейнера, строки
 * с шагом — линии строятся из тех же чисел, без чтения положения узлов из DOM.
 */

type Filter = 'ALL' | CooperationStatus

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'ALL', label: 'Все связки' },
  { key: 'ACTIVE', label: 'В работе' },
  { key: 'DRAFT', label: 'Черновики' },
  { key: 'PAUSED', label: 'Приостановлены' },
  { key: 'COMPLETED', label: 'Завершены' },
]

/** Размеры узлов и шаг строк — в пикселях раскладки. */
const NODE_W = 232
const NODE_H = 66
const ROW = 88
const PAD_Y = 20

const TONE: Record<CooperationStatus, string> = {
  ACTIVE: styles.toneActive!,
  DRAFT: styles.toneDraft!,
  PAUSED: styles.tonePaused!,
  COMPLETED: styles.toneDone!,
  CANCELLED: styles.toneDraft!,
}

interface ProductNode {
  key: string
  id: string | null
  name: string
}

/** Кривая Безье между двумя точками по горизонтали — «провод» узлового редактора. */
function wire(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, (x2 - x1) * 0.5)
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
}

export function UniversityGraph({
  universityId,
  universityName,
  universityCode,
}: {
  universityId: string
  universityName: string
  /** Короткое имя для узла вуза. */
  universityCode: string
}) {
  const reduced = useCalmMotion()
  const [filter, setFilter] = useState<Filter>('ALL')
  const [hovered, setHovered] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  const programs = useResource<ProgramListItemDto[]>(`/api/programs${buildQuery({ universityId, pageSize: 50 })}`)
  const cooperations = useResource<CooperationListItemDto[]>(
    `/api/cooperations${buildQuery({ universityId, pageSize: 100 })}`,
  )

  const counts = useMemo(() => {
    const all = (cooperations.data ?? []).filter((item) => item.status !== 'CANCELLED')
    const result: Record<Filter, number> = {
      ALL: all.length,
      ACTIVE: 0,
      DRAFT: 0,
      PAUSED: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    }
    for (const item of all) result[item.status] += 1
    return result
  }, [cooperations.data])

  const layout = useMemo(() => {
    const programList = programs.data ?? []
    const links = (cooperations.data ?? []).filter(
      (item) => item.status !== 'CANCELLED' && (filter === 'ALL' || item.status === filter),
    )
    // Продукты — только те, к которым ведут показанные связки; «не выбран» — отдельным узлом.
    const productMap = new Map<string, ProductNode>()
    for (const link of links) {
      const key = link.productId ?? 'none'
      if (!productMap.has(key)) {
        productMap.set(key, { key, id: link.productId, name: link.productName ?? 'Продукт не выбран' })
      }
    }
    // Продукт — на уровне своих программ (средний номер строки): провода не
    // перекрещиваются, и метки этапов не ложатся одна на другую.
    const programIndex = new Map(programList.map((program, index) => [program.id, index]))
    const rank = (key: string) => {
      const rows = links
        .filter((link) => (link.productId ?? 'none') === key)
        .map((link) => programIndex.get(link.programId) ?? 0)
      return rows.reduce((sum, row) => sum + row, 0) / Math.max(rows.length, 1)
    }
    const products = [...productMap.values()].sort((a, b) =>
      a.id === null ? 1 : b.id === null ? -1 : rank(a.key) - rank(b.key) || a.name.localeCompare(b.name, 'ru'),
    )
    const rows = Math.max(programList.length, products.length, 1)
    const height = rows * ROW + PAD_Y * 2
    const colX = [0, Math.max(NODE_W + 60, width / 2 - NODE_W / 2), Math.max(NODE_W * 2 + 120, width - NODE_W)]
    const rowY = (index: number, count: number) =>
      PAD_Y + (height - PAD_Y * 2 - count * ROW) / 2 + index * ROW + (ROW - NODE_H) / 2
    const uniY = height / 2 - NODE_H / 2
    const programY = new Map(programList.map((program, index) => [program.id, rowY(index, programList.length)]))
    const productY = new Map(products.map((product, index) => [product.key, rowY(index, products.length)]))
    const activePrograms = new Set(links.map((link) => link.programId))
    // Метки этапов — в середине своей кривой; совпавшие раздвигаются по вертикали.
    const chips = new Map<string, { x: number; y: number }>()
    const taken: Array<{ x: number; y: number }> = []
    for (const link of links) {
      const y1 = programY.get(link.programId)
      const y2 = productY.get(link.productId ?? 'none')
      if (y1 === undefined || y2 === undefined) continue
      const x = (colX[1]! + NODE_W + colX[2]!) / 2
      let y = (y1 + y2) / 2 + NODE_H / 2
      while (taken.some((spot) => Math.abs(spot.y - y) < 24 && Math.abs(spot.x - x) < 90)) y += 26
      taken.push({ x, y })
      chips.set(link.id, { x, y })
    }
    return { programList, products, links, height, colX, uniY, programY, productY, activePrograms, chips }
  }, [programs.data, cooperations.data, filter, width])

  const loading = programs.isLoading || cooperations.isLoading
  const contentWidth = layout.colX[2]! + NODE_W

  const edgeDim = (a: string, b: string) => hovered !== null && hovered !== a && hovered !== b

  return (
    <section className={styles.root} aria-label={`Граф связей: ${universityName}`}>
      <div className={styles.tabs} role="tablist" aria-label="Связки по статусу">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={`${styles.tab} ${filter === key ? styles.tabActive : ''}`}
            onClick={() => setFilter(key)}
          >
            {label}
            <span className={styles.tabCount}>{formatNumber(counts[key])}</span>
          </button>
        ))}
      </div>

      <div ref={boxRef} className={styles.canvas}>
        {loading ? (
          <SkeletonLines count={4} />
        ) : layout.programList.length === 0 ? (
          <EmptyState title="Программ пока нет" description="Граф появится, когда у вуза будет первая программа." />
        ) : (
          <div className={styles.scroll}>
            <div className={styles.stage} style={{ width: contentWidth, height: layout.height }}>
              <svg className={styles.wires} width={contentWidth} height={layout.height} aria-hidden>
                {/* Вуз → программы */}
                {layout.programList.map((program, index) => {
                  const y = layout.programY.get(program.id)! + NODE_H / 2
                  const d = wire(layout.colX[0]! + NODE_W, layout.uniY + NODE_H / 2, layout.colX[1]!, y)
                  const dim = !layout.activePrograms.has(program.id) || edgeDim('uni', program.id)
                  return (
                    <motion.path
                      key={`u-${program.id}-${filter}`}
                      d={d}
                      className={`${styles.wire} ${styles.wireBase} ${dim ? styles.wireDim : ''}`}
                      initial={reduced ? false : { pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.6, delay: 0.25 + index * 0.05, ease: [0.16, 1, 0.3, 1] }}
                    />
                  )
                })}
                {/* Программа → продукт: связки */}
                {layout.links.map((link, index) => {
                  const y1 = layout.programY.get(link.programId)
                  const y2 = layout.productY.get(link.productId ?? 'none')
                  if (y1 === undefined || y2 === undefined) return null
                  const d = wire(layout.colX[1]! + NODE_W, y1 + NODE_H / 2, layout.colX[2]!, y2 + NODE_H / 2)
                  const dim = edgeDim(link.programId, link.productId ?? 'none')
                  return (
                    <g key={`${link.id}-${filter}`} className={TONE[link.status]}>
                      <motion.path
                        d={d}
                        className={`${styles.wire} ${dim ? styles.wireDim : ''}`}
                        initial={reduced ? false : { pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.7, delay: 0.55 + index * 0.06, ease: [0.16, 1, 0.3, 1] }}
                      />
                      {/* Импульс по проводу — связка живая, пока в работе. */}
                      {link.status === 'ACTIVE' && !reduced && (
                        <circle r="3.5" className={styles.pulse}>
                          <animateMotion dur={`${2.4 + (index % 3) * 0.5}s`} repeatCount="indefinite" path={d} />
                        </circle>
                      )}
                    </g>
                  )
                })}
              </svg>

              {/* Метки этапа посередине проводов — ссылки на связку. */}
              {layout.links.map((link, index) => {
                const spot = layout.chips.get(link.id)
                if (!spot) return null
                const { x, y } = spot
                const stage = link.currentStage ? `этап ${link.currentStage.stageNumber}/14` : 'все этапы'
                return (
                  <motion.div
                    key={`chip-${link.id}-${filter}`}
                    className={`${styles.chipWrap} ${TONE[link.status]}`}
                    style={{ left: x, top: y }}
                    initial={reduced ? false : { opacity: 0, scale: 0.8 }}
                    animate={{ opacity: edgeDim(link.programId, link.productId ?? 'none') ? 0.25 : 1, scale: 1 }}
                    transition={{ delay: reduced ? 0 : 0.9 + index * 0.06, duration: 0.3 }}
                  >
                    <Link
                      href={cooperationHref(link.id)}
                      className={styles.chip}
                      title={`${COOPERATION_STATUS_LABELS[link.status]} · ${link.progress.percent}% этапов закрыто`}
                    >
                      {stage}
                      <span className={styles.chipPct}>{link.progress.percent}%</span>
                    </Link>
                  </motion.div>
                )
              })}

              {/* Узел вуза */}
              <motion.div
                className={`${styles.node} ${styles.nodeUni}`}
                style={{ left: layout.colX[0], top: layout.uniY, width: NODE_W, height: NODE_H }}
                initial={reduced ? false : { opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4 }}
                onPointerEnter={() => setHovered('uni')}
                onPointerLeave={() => setHovered(null)}
              >
                <span className={styles.kind}>Вуз</span>
                <span className={styles.title}>{universityCode}</span>
                <span className={styles.sub}>{formatNumber(layout.programList.length)} программ</span>
              </motion.div>

              {layout.programList.map((program, index) => (
                <motion.div
                  key={program.id}
                  className={`${styles.nodeWrap} ${layout.activePrograms.has(program.id) ? '' : styles.nodeIdle}`}
                  style={{ left: layout.colX[1], top: layout.programY.get(program.id), width: NODE_W, height: NODE_H }}
                  initial={reduced ? false : { opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.15 + index * 0.05 }}
                  onPointerEnter={() => setHovered(program.id)}
                  onPointerLeave={() => setHovered(null)}
                >
                  <Link href={programHref(program.id)} className={styles.node}>
                    <span className={styles.kind}>
                      Программа
                      <span className={styles.tag}>{PROGRAM_LEVEL_LABELS[program.level]}</span>
                    </span>
                    <span className={styles.title}>{program.name}</span>
                    <span className={styles.sub}>{program.code ?? program.direction ?? '—'}</span>
                  </Link>
                </motion.div>
              ))}

              {layout.products.map((product, index) => (
                <motion.div
                  key={product.key}
                  className={styles.nodeWrap}
                  style={{ left: layout.colX[2], top: layout.productY.get(product.key), width: NODE_W, height: NODE_H }}
                  initial={reduced ? false : { opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.45 + index * 0.05 }}
                  onPointerEnter={() => setHovered(product.key)}
                  onPointerLeave={() => setHovered(null)}
                >
                  {product.id ? (
                    <Link href={productHref(product.id)} className={`${styles.node} ${styles.nodeProduct}`}>
                      <span className={styles.kind}>IT-продукт</span>
                      <span className={styles.title}>{product.name}</span>
                    </Link>
                  ) : (
                    <span className={`${styles.node} ${styles.nodeEmpty}`}>
                      <span className={styles.kind}>IT-продукт</span>
                      <span className={styles.title}>{product.name}</span>
                    </span>
                  )}
                </motion.div>
              ))}

              {layout.links.length === 0 && (
                <p className={styles.noLinks} style={{ left: layout.colX[2], top: layout.height / 2 - 12 }}>
                  Связок с таким статусом нет
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <ul className={styles.legend} aria-label="Цвета связок">
        {(['ACTIVE', 'DRAFT', 'PAUSED', 'COMPLETED'] as const).map((status) => (
          <li key={status} className={TONE[status]}>
            <span className={styles.legendLine} aria-hidden />
            {COOPERATION_STATUS_LABELS[status]}
          </li>
        ))}
      </ul>
    </section>
  )
}
