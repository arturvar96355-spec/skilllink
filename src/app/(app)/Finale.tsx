'use client'

import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { CooperationListItemDto } from '@/shared/contracts'
import { useCalmMotion, useReveal } from '@/ui'
import styles from './Finale.module.css'

/**
 * Финальная секция главной (решение 125, бриф v2 — 2.5): сеть SkillLink —
 * ВУЗЫ → ПРОГРАММЫ → НАВЫКИ → IT-ПРОДУКТЫ.
 *
 * Честно про «витрину» (решение 180, п. 3): линии вуз → программа и
 * программа → продукт — настоящие связки из данных главной. Полоса навыков
 * между ними — иллюстрация, не данные: своих связей «программа — навык»
 * в сводке нет, поэтому маршрут к продукту проходит через ближайший по
 * высоте навык на схеме, а не через тот, что реально изучается на этой
 * программе. Заголовок блока и подпись под схемой говорят об этом прямо,
 * чтобы полосу не приняли за настоящую связь «программа — навык».
 *
 * При появлении линии прорисовываются по очереди, затем по ним изредка бегут
 * импульсы — по одному, не всё разом. Одно SVG и CSS-анимации: прокрутку не
 * тормозит. «Уменьшить движение» и рабочий режим — статичная картинка.
 *
 * Правка по замечанию владельца (решение 180, доп. к п. 3, скриншот светлой
 * темы): подпись узла — на подложке цвета фона, а не только с обводкой
 * букв (обводка красит контур каждой буквы, а линия, идущая через межбуквенный
 * пробел, всё равно была видна); одноимённые программы разных вузов различает
 * короткое имя вуза в подписи и полное — во всплывающей подсказке узла.
 *
 * На телефоне (решение 208) четыре столбца не помещаются: поле не уже 560 px
 * сжималось в ~330 px, подписи выходили 6–7 px, а линии терялись — блок
 * казался пустым. Там та же схема идёт сверху вниз: у каждого вуза — линия
 * «вуз → программа → IT-продукт» из тех же связок, что на широкой схеме,
 * с теми же цветами точек, подписи обычного размера и целиком. Навыки —
 * одной строкой под схемой, как и на широкой, — иллюстрация, не данные.
 */

interface Chain {
  id: string
  label: string
  tooltip: string
  programs: Array<{ id: string; label: string; products: string[] }>
}

/**
 * Линии телефонной схемы: вузы и программы — те же, что на широкой схеме
 * (первые MAX_NODES), продукты программы — все её продукты из связок этого вуза.
 * Вуз без показанной программы не рисуется: линии у него на схеме нет.
 */
function chainsOf(cooperations: CooperationListItemDto[], universities: Node[], programs: Node[]): Chain[] {
  const shownPrograms = new Set(programs.map((node) => node.id))
  return universities
    .map((uni) => {
      const byProgram = new Map<string, { id: string; label: string; products: string[] }>()
      for (const item of cooperations) {
        if (item.universityId !== uni.id || !shownPrograms.has(item.programId)) continue
        const program = byProgram.get(item.programId) ?? { id: item.programId, label: item.programName, products: [] }
        if (item.productName && !program.products.includes(item.productName)) program.products.push(item.productName)
        byProgram.set(item.programId, program)
      }
      return { id: uni.id, label: uni.label, tooltip: uni.tooltip, programs: [...byProgram.values()] }
    })
    .filter((chain) => chain.programs.length > 0)
}

const HEIGHT = 400
/** Место сверху: заголовки столбцов и подписи над первыми узлами. */
const TOP = 76
const BOTTOM = 32
const COLUMNS = [0.1, 0.37, 0.63, 0.9]
const TITLES = ['Вузы', 'Программы', 'Навыки рынка', 'IT-продукты']
/** Больше узлов в столбце подписи не держат. */
const MAX_NODES = 7
/** Длиннее подпись узла обрезается: иначе соседние столбцы подписей наезжают друг на друга. */
const LABEL_MAX_CHARS = 26

interface Entry {
  id: string
  /** Что рисуется на схеме — после разбора одноимённых (см. `disambiguate`). */
  label: string
  /** Полное описание узла — во всплывающей подсказке, не зависит от обрезки и разбора. */
  tooltip: string
}

interface Node extends Entry {
  key: string
  x: number
  y: number
}

/** Подпись узла, которая рисуется: длиннее общего предела — обрезается многоточием. */
function displayLabel(label: string): string {
  return label.length <= LABEL_MAX_CHARS ? label : `${label.slice(0, LABEL_MAX_CHARS - 1)}…`
}

/**
 * Программы называются по направлению, и одно название бывает у разных вузов
 * («Информационная безопасность» — не редкость): без разбора это выглядит как
 * дубль одного узла. К одноимённым добавляется короткое имя вуза — во
 * всплывающей подсказке (`tooltip`) вуз назван всегда, независимо от разбора.
 */
function disambiguate(entries: Array<Entry & { university: string }>): Entry[] {
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.label, (counts.get(entry.label) ?? 0) + 1)
  return entries.map(({ university, ...entry }) =>
    (counts.get(entry.label) ?? 0) > 1 ? { ...entry, label: `${entry.label} · ${university}` } : entry,
  )
}

function column(entries: Entry[], index: number, width: number): Node[] {
  const list = entries.slice(0, MAX_NODES)
  const span = HEIGHT - TOP - BOTTOM
  return list.map((entry, i) => ({
    ...entry,
    key: `${index}:${entry.id}`,
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

  const uniEntries: Entry[] = [
    ...new Map(
      cooperations.map((c) => {
        const label = c.universityShortName ?? c.universityName
        return [c.universityId, { id: c.universityId, label, tooltip: c.universityName }] as const
      }),
    ).values(),
  ]
  const programEntries: Entry[] = disambiguate([
    ...new Map(
      cooperations.map((c) => {
        const university = c.universityShortName ?? c.universityName
        return [
          c.programId,
          { id: c.programId, label: c.programName, tooltip: `${c.programName} — ${university}`, university },
        ] as const
      }),
    ).values(),
  ])
  const skillEntries: Entry[] = skills.map((name, index) => ({ id: `${index}:${name}`, label: name, tooltip: name }))
  const productEntries: Entry[] = [
    ...new Map(
      cooperations
        .filter((c) => c.productId)
        .map((c) => [c.productId!, { id: c.productId!, label: c.productName!, tooltip: c.productName! }] as const),
    ).values(),
  ]

  const uniNodes = column(uniEntries, 0, width)
  const programNodes = column(programEntries, 1, width)
  const skillNodes = column(skillEntries, 2, width)
  const productNodes = column(productEntries, 3, width)
  const find = (nodes: Node[], id: string) => nodes.find((node) => node.id === id)

  // Настоящие связки: вуз → программа и программа → (через навыки) → продукт.
  const routes: Array<{ key: string; d: string; kind: 'uni' | 'product'; skill: string | null }> = []
  const seen = new Set<string>()
  for (const item of cooperations) {
    const uni = find(uniNodes, item.universityId)
    const program = find(programNodes, item.programId)
    if (uni && program && !seen.has(`${uni.key}>${program.key}`)) {
      seen.add(`${uni.key}>${program.key}`)
      routes.push({ key: `${uni.key}>${program.key}`, d: curve(uni, program), kind: 'uni', skill: null })
    }
    const product = item.productId ? find(productNodes, item.productId) : undefined
    if (program && product && !seen.has(`${program.key}>${product.key}`)) {
      seen.add(`${program.key}>${product.key}`)
      const { d, skill } = throughSkills(program, product, skillNodes)
      routes.push({ key: `${program.key}>${product.key}`, d, kind: 'product', skill: skill?.key ?? null })
    }
  }
  const cycle = Math.max(routes.length, 4) * 1.4
  const chains = chainsOf(cooperations, uniNodes, programNodes)
  const shownSkills = skillEntries.slice(0, MAX_NODES).map((entry) => entry.label)

  return (
    <div ref={ref} className={styles.stage} data-shown={shown || undefined} data-calm={calm || undefined}>
      <svg viewBox={`0 0 ${width} ${HEIGHT}`} className={styles.svg} role="img" aria-label="Схема сети SkillLink: вузы, программы, навыки рынка и IT-продукты">
        {TITLES.map((title, index) => (
          <text key={title} x={COLUMNS[index]! * width} y={22} textAnchor="middle" className={styles.columnTitle}>
            {title}
          </text>
        ))}
        {/* Полоса навыков — «фильтр», через который идут маршруты к продуктам. */}
        <rect
          x={COLUMNS[2]! * width - 70}
          y={TOP - 36}
          width={140}
          height={HEIGHT - TOP - BOTTOM + 54}
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

        {/*
          Точки и подписи — двумя проходами, оба целиком после линий: подпись
          иначе оказалась бы под линией, до которой в списке ещё не дошла
          отрисовка. Подложки под подписью нет (решение 211): сплошной
          прямоугольник рвал линии связей, и схема читалась как обрывки.
          Читаемость держит обводка букв цветом фона панели (CSS, paint-order):
          линия идёт непрерывно и прячется только под самими буквами.
        */}
        {[uniNodes, programNodes, skillNodes, productNodes].map((nodes, columnIndex) =>
          nodes.map((node, index) => (
            <g
              key={`dot:${node.key}`}
              className={[styles.node, styles[`col${columnIndex}`]].join(' ')}
              style={{ '--n': columnIndex * 3 + index } as CSSProperties}
            >
              <circle cx={node.x} cy={node.y} r={14} className={styles.nodeHalo} />
              <circle cx={node.x} cy={node.y} r={5} className={styles.nodeCore} />
            </g>
          )),
        )}
        {[uniNodes, programNodes, skillNodes, productNodes].map((nodes, columnIndex) =>
          nodes.map((node, index) => {
            const anchor = columnIndex === 0 ? 'start' : columnIndex === 3 ? 'end' : 'middle'
            const textX = node.x + (columnIndex === 0 ? -8 : columnIndex === 3 ? 8 : 0)
            const textY = node.y - 20
            const label = displayLabel(node.label)
            return (
              <g
                key={`label:${node.key}`}
                className={styles.node}
                style={{ '--n': columnIndex * 3 + index } as CSSProperties}
              >
                {/* Полное название узла — во всплывающей подсказке: у программ — с вузом
                    всегда, у остальных — как страховка на случай обрезки длинного имени. */}
                <title>{node.tooltip}</title>
                <text x={textX} y={textY} textAnchor={anchor} className={styles.nodeLabel}>
                  {label}
                </text>
              </g>
            )
          }),
        )}
      </svg>

      {/* Телефон: та же схема сверху вниз (решение 208). */}
      <div className={styles.narrow}>
        <p className={styles.legend} aria-hidden>
          <span className={styles.legendUni}>Вуз</span>
          <span className={styles.legendProgram}>Программа</span>
          <span className={styles.legendProduct}>IT-продукт</span>
        </p>
        <ol className={styles.chains} aria-label="Связки сети SkillLink: вуз, программа, IT-продукт">
          {chains.map((chain) => (
            <li key={chain.id} className={styles.chain}>
              <span className={`${styles.stop} ${styles.stopUni}`} title={chain.tooltip}>
                {chain.label}
              </span>
              {chain.programs.map((program) => (
                <Fragment key={program.id}>
                  <span className={`${styles.stop} ${styles.stopProgram}`}>{program.label}</span>
                  {program.products.length > 0 ? (
                    program.products.map((product) => (
                      <span key={product} className={`${styles.stop} ${styles.stopProduct}`}>
                        {product}
                      </span>
                    ))
                  ) : (
                    <span className={`${styles.stop} ${styles.stopNone}`}>продукт ещё не выбран</span>
                  )}
                </Fragment>
              ))}
            </li>
          ))}
        </ol>
        {shownSkills.length > 0 && (
          <p className={styles.skillsLine}>
            <span className={styles.skillsTitle}>Навыки рынка на пути:</span> {shownSkills.join(', ')}
          </p>
        )}
      </div>

      <p className={styles.caption}>
        Схема. Линии «вуз → программа → продукт» — настоящие связки из данных. Навыки на пути — самые
        востребованные рынком в целом, а не обязательно те, что изучаются именно на этой программе.
      </p>
    </div>
  )
}
