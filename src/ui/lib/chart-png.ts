/**
 * Скачивание диаграмм в PNG (ТЗ заказчика, функц. 1: «диаграммы, графики в форматах
 * png, pdf»; ТЗ фронта 28.09, Ф6). Без библиотек: диаграмма рисуется на canvas
 * в двойном масштабе, сверху — название, пояснение (фильтры, период) и дата.
 *
 * - SVG-диаграммы (кольца, «Связки по вузам», воронка главной) — клоном SVG, в который
 *   подставлены вычисленные стили: иначе цвета из CSS-переменных и классов модулей
 *   в картинку не попадают.
 * - Полосы аналитики (MeasureBars) — HTML, поэтому рисуются заново по тем же данным;
 *   цвета берутся с отрисованных полос в светлой теме — совпадают с режимом и тоном.
 *
 * Картинка всегда светлая, какой бы ни была тема экрана (решение 232): её вставляют
 * в документы и печатают, тёмный фон там — тонер и чужой вид. На время снятия стилей
 * у страницы на один синхронный шаг стоит светлая тема (`withLightTheme`) — между
 * кадрами, поэтому на экране ничего не мигает. Фон — непрозрачный белый холст светлой
 * темы: прозрачный дал бы чёрную картинку в одних программах и белую в других.
 * Ссылка на файл живёт 5 минут: iPhone Safari не успевал сохранить файл, если её
 * отзывали сразу (та же ошибка, что у выгрузки отчётов).
 */

export interface ChartPngMeta {
  /** Название диаграммы — первая строка картинки и основа имени файла. */
  title: string
  /** Фильтры, период, что показывает — вторая строка. */
  note?: string
}

/** Пока стоит, переходы цветов на странице выключены (globals.css): снимок берёт итоговый цвет, а не начало перехода. */
export const PNG_CAPTURE_ATTRIBUTE = 'data-png-capture'

/**
 * Синхронно выполнить `read` так, будто на странице светлая тема, и вернуть тему назад
 * (решение 232). Всё внутри — один шаг без ожиданий: браузер не успевает нарисовать
 * кадр, и пользователь светлой вспышки не видит. Переходы на это время выключены —
 * иначе `getComputedStyle` отдал бы цвет начала перехода, то есть тёмный. Тема
 * возвращается ещё при выключенных переходах, с принудительным пересчётом стилей:
 * иначе цвета «перетекли» бы из светлых обратно в тёмные у всех на глазах.
 */
export function withLightTheme<T>(read: () => T, root: HTMLElement = document.documentElement): T {
  const previous = root.getAttribute('data-theme')
  const switchTheme = previous !== 'light'
  root.setAttribute(PNG_CAPTURE_ATTRIBUTE, '')
  if (switchTheme) root.setAttribute('data-theme', 'light')
  try {
    return read()
  } finally {
    if (switchTheme) {
      if (previous === null) root.removeAttribute('data-theme')
      else root.setAttribute('data-theme', previous)
      void root.getBoundingClientRect()
    }
    root.removeAttribute(PNG_CAPTURE_ATTRIBUTE)
  }
}

const SCALE = 2
const PAD = 24
const LINK_TTL_MS = 5 * 60 * 1000

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

/** `skilllink-svyazki-po-vuzam-2026-09-28.png`: латиница — имя читается в любой системе. */
export function chartFileName(title: string, date: Date = new Date()): string {
  const slug = title
    .toLowerCase()
    .split('')
    .map((char) => TRANSLIT[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-')
  return `skilllink-${slug || 'diagramma'}-${day}.png`
}

/** «28.09.2026, 18:40» — когда снята картинка. */
function stamp(date: Date): string {
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface Palette {
  canvas: string
  text: string
  secondary: string
  tertiary: string
  track: string
  font: string
}

function palette(): Palette {
  const root = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback
  return {
    canvas: getComputedStyle(document.body).backgroundColor || read('--canvas', '#ffffff'),
    text: read('--text-primary', '#16122a'),
    secondary: read('--text-secondary', '#474159'),
    tertiary: read('--text-tertiary', '#625d74'),
    track: read('--line-subtle', 'rgba(0,0,0,0.08)'),
    font: getComputedStyle(document.body).fontFamily || 'sans-serif',
  }
}

/** Высота шапки картинки в CSS-пикселях. */
function headerHeight(meta: ChartPngMeta): number {
  return PAD + 24 + (meta.note ? 20 : 0) + 18 + 16
}

function drawHeader(ctx: CanvasRenderingContext2D, meta: ChartPngMeta, colors: Palette, width: number) {
  let y = PAD + 18
  ctx.fillStyle = colors.text
  ctx.font = `600 18px ${colors.font}`
  ctx.fillText(meta.title, PAD, y, width - 2 * PAD)
  if (meta.note) {
    y += 20
    ctx.fillStyle = colors.secondary
    ctx.font = `400 13px ${colors.font}`
    ctx.fillText(meta.note, PAD, y, width - 2 * PAD)
  }
  y += 18
  ctx.fillStyle = colors.tertiary
  ctx.font = `400 12px ${colors.font}`
  ctx.fillText(`SkillLink · ${stamp(new Date())}`, PAD, y, width - 2 * PAD)
}

function newCanvas(width: number, height: number, colors: Palette) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * SCALE)
  canvas.height = Math.round(height * SCALE)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Браузер не дал нарисовать картинку.')
  ctx.scale(SCALE, SCALE)
  ctx.fillStyle = colors.canvas
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'alphabetic'
  return { canvas, ctx }
}

async function save(canvas: HTMLCanvasElement, fileName: string): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Не удалось собрать картинку.')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), LINK_TTL_MS)
}

// ── SVG ──────────────────────────────────────────────────────────────────────

/** Свойства, которые переносятся из вычисленного стиля в разметку клона. */
const SVG_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'paint-order',
  'visibility',
  'display',
  'stop-color',
  'stop-opacity',
] as const

function inlineStyles(source: Element, clone: Element) {
  const computed = getComputedStyle(source)
  const style = SVG_PROPS.map((prop) => `${prop}:${computed.getPropertyValue(prop)}`).join(';')
  clone.setAttribute('style', style)
  // Классы модулей в отдельном файле SVG ничего не значат, а мешать могут.
  clone.removeAttribute('class')
  const sourceChildren = source.children
  const cloneChildren = clone.children
  for (let i = 0; i < sourceChildren.length; i += 1) {
    const child = cloneChildren[i]
    const origin = sourceChildren[i]
    if (child && origin) inlineStyles(origin, child)
  }
}

/** Клон SVG с перенесёнными стилями — строкой; синхронно, пока стоит светлая тема. */
function svgSource(svg: SVGSVGElement, width: number, height: number): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  inlineStyles(svg, clone)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  return new XMLSerializer().serializeToString(clone)
}

async function loadImage(source: string): Promise<HTMLImageElement> {
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Не удалось нарисовать диаграмму.'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
  })
  return image
}

/** Элемент виден на экране: не скрыт, не прозрачен, не «только для чтения вслух». */
function isShown(element: Element): boolean {
  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
  const box = element.getBoundingClientRect()
  return box.width > 1 && box.height > 1
}

/**
 * Диаграмма главной — картинкой (кольца, «Связки по вузам», воронка, фазы).
 * Рисуется весь блок: SVG-части — с вычисленными стилями, подписи HTML (название,
 * число в центре кольца, легенда) — слово в слово по их месту на экране тем же
 * шрифтом и цветом, цветные метки легенды — как есть. Так на картинке то же, что
 * на экране, без библиотеки снимков страницы.
 */
export async function downloadSvgPng(container: HTMLElement, meta: ChartPngMeta): Promise<string> {
  const snapshot = withLightTheme(() => readSvgChart(container, meta))
  const images = await Promise.all(
    snapshot.svgs.map(async (svg) => ({ ...svg, image: await loadImage(svg.source) })),
  )

  const { canvas, ctx } = newCanvas(snapshot.width, snapshot.height, snapshot.colors)
  drawHeader(ctx, meta, snapshot.colors, snapshot.width)

  // Цветные метки легенды и точки — маленькие элементы с заливкой.
  for (const dot of snapshot.dots) {
    ctx.fillStyle = dot.fill
    ctx.beginPath()
    if (dot.round) ctx.arc(dot.x + dot.width / 2, dot.y + dot.height / 2, dot.width / 2, 0, Math.PI * 2)
    else ctx.rect(dot.x, dot.y, dot.width, dot.height)
    ctx.fill()
  }

  for (const { x, y, width, height, image } of images) ctx.drawImage(image, x, y, width, height)

  // Подписи HTML — по словам: перенос строк на картинке тот же, что на экране.
  ctx.textBaseline = 'middle'
  for (const word of snapshot.words) {
    ctx.font = word.font
    ctx.fillStyle = word.color
    ctx.fillText(word.text, word.x, word.y)
  }
  ctx.textBaseline = 'alphabetic'

  const fileName = chartFileName(meta.title)
  await save(canvas, fileName)
  return fileName
}

interface SvgChartSnapshot {
  colors: Palette
  width: number
  height: number
  svgs: { source: string; x: number; y: number; width: number; height: number }[]
  dots: { x: number; y: number; width: number; height: number; fill: string; round: boolean }[]
  words: { text: string; x: number; y: number; font: string; color: string }[]
}

/** Всё, что берётся со страницы: размеры, стили, SVG и подписи — одним синхронным шагом. */
function readSvgChart(container: HTMLElement, meta: ChartPngMeta): SvgChartSnapshot {
  const area = container.getBoundingClientRect()
  const colors = palette()
  const top = headerHeight(meta)
  const width = Math.max(area.width + 2 * PAD, 480)
  const height = top + area.height + PAD
  const offsetX = (width - area.width) / 2
  const at = (box: DOMRect) => ({ x: offsetX + box.left - area.left, y: top + box.top - area.top })

  const svgs = [...container.querySelectorAll('svg')]
    .filter(
      (svg): svg is SVGSVGElement => svg instanceof SVGSVGElement && !svg.parentElement?.closest('svg') && isShown(svg),
    )
    .map((svg) => {
      const box = svg.getBoundingClientRect()
      return { source: svgSource(svg, box.width, box.height), ...at(box), width: box.width, height: box.height }
    })

  const dots: SvgChartSnapshot['dots'] = []
  container.querySelectorAll<HTMLElement>('*').forEach((element) => {
    if (element.closest('svg') || !isShown(element)) return
    const box = element.getBoundingClientRect()
    if (box.width > 18 || box.height > 18) return
    const style = getComputedStyle(element)
    const fill = style.backgroundColor
    if (!fill || fill === 'rgba(0, 0, 0, 0)' || fill === 'transparent') return
    dots.push({
      ...at(box),
      width: box.width,
      height: box.height,
      fill,
      round: parseFloat(style.borderTopLeftRadius) >= box.width / 2 - 0.5,
    })
  })

  const words: SvgChartSnapshot['words'] = []
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    const text = node.textContent ?? ''
    if (!parent || parent.closest('svg') || !text.trim() || !isShown(parent)) continue
    const style = getComputedStyle(parent)
    const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    for (const word of text.matchAll(/\S+/g)) {
      range.setStart(node, word.index ?? 0)
      range.setEnd(node, (word.index ?? 0) + word[0].length)
      const box = range.getBoundingClientRect()
      if (box.width === 0) continue
      const { x, y } = at(box)
      words.push({ text: word[0], x, y: y + box.height / 2, font, color: style.color })
    }
  }

  return { colors, width, height, svgs, dots, words }
}

// ── Полосы MeasureBars ────────────────────────────────────────────────────────

export interface MeasurePngRow {
  label: string
  caption?: string
  /** Доля полосы 0..1; null — «нет данных», полосы нет. */
  share: number | null
  valueText: string
  /** Цвет полосы — вычисленный с отрисованной полосы. */
  color: string
  note?: string
  between?: string
}

const ROW_H = 30
const LABEL_W = 240
const BAR_W = 360
const VALUE_W = 130

export async function downloadMeasurePng(rows: MeasurePngRow[], meta: ChartPngMeta): Promise<string> {
  const colors = withLightTheme(palette)
  const hasNotes = rows.some((row) => row.note)
  const width = PAD + LABEL_W + BAR_W + 12 + VALUE_W + (hasNotes ? 220 : 0) + PAD
  const betweenCount = rows.filter((row) => row.between).length
  const top = headerHeight(meta)
  const height = top + rows.length * ROW_H + betweenCount * 20 + PAD
  const { canvas, ctx } = newCanvas(width, height, colors)
  drawHeader(ctx, meta, colors, width)

  let y = top
  for (const row of rows) {
    if (row.between) {
      ctx.fillStyle = colors.tertiary
      ctx.font = `400 12px ${colors.font}`
      ctx.fillText(`↓ ${row.between}`, PAD + LABEL_W, y + 13, BAR_W + VALUE_W)
      y += 20
    }
    const mid = y + ROW_H / 2
    ctx.fillStyle = colors.text
    ctx.font = `500 13px ${colors.font}`
    ctx.fillText(row.label, PAD, row.caption ? mid - 2 : mid + 4, LABEL_W - 12)
    if (row.caption) {
      ctx.fillStyle = colors.tertiary
      ctx.font = `400 11px ${colors.font}`
      ctx.fillText(row.caption, PAD, mid + 12, LABEL_W - 12)
    }
    const barX = PAD + LABEL_W
    ctx.fillStyle = colors.track
    ctx.fillRect(barX, mid - 5, BAR_W, 10)
    if (row.share !== null) {
      ctx.fillStyle = row.color
      ctx.fillRect(barX, mid - 5, Math.max(2, BAR_W * Math.min(1, row.share)), 10)
    }
    ctx.fillStyle = row.share === null ? colors.tertiary : colors.text
    ctx.font = `600 13px ${colors.font}`
    ctx.fillText(row.valueText, barX + BAR_W + 12, mid + 4, VALUE_W)
    if (hasNotes && row.note) {
      ctx.fillStyle = colors.secondary
      ctx.font = `400 12px ${colors.font}`
      ctx.fillText(row.note, barX + BAR_W + 12 + VALUE_W, mid + 4, 210)
    }
    y += ROW_H
  }

  const fileName = chartFileName(meta.title)
  await save(canvas, fileName)
  return fileName
}
