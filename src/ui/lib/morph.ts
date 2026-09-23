'use client'

/**
 * Переход «строка реестра → карточка» (07, раздел 9).
 *
 * Обычная смена страницы стирала реестр и рисовала карточку с нуля: человек
 * терял объект, на который только что нажал. Здесь название объекта не исчезает:
 * по щелчку оно отделяется от строки копией поверх экрана, остальные строки
 * приглушаются, а когда карточка отрисовала заголовок, копия переезжает на его
 * место и масштабируется под его размер — и заголовок проявляется под ней.
 *
 * Копия, а не общий элемент двух страниц: страницы Next монтируются заново,
 * и переход не должен зависеть от того, успела ли карточка загрузить данные.
 * Пока карточка грузится, название ждёт на месте строки — это и есть
 * «название остаётся визуально стабильным». Не дождалось за полторы секунды —
 * тихо исчезает: переход — украшение, а не условие работы.
 */

interface Pending {
  clone: HTMLElement
  from: DOMRect
  table: HTMLElement | null
  source: HTMLElement
}

/**
 * Где в ячейке само название. Ссылка вне таблицы помечает его сама
 * (`data-morph-title`): в строке-маршруте самый длинный текст — не всегда то,
 * что станет заголовком. Иначе — самый длинный текст без вложенных элементов:
 * рядом с названием бывают буква-аватар и подписи, их не переносим.
 */
function titleIn(cell: HTMLElement): HTMLElement {
  const marked = cell.matches('[data-morph-title]')
    ? cell
    : cell.querySelector<HTMLElement>('[data-morph-title]')
  if (marked) return marked
  let best: HTMLElement = cell
  let bestLength = 0
  for (const element of Array.from(cell.querySelectorAll<HTMLElement>('*'))) {
    if (element.children.length > 0) continue
    const length = element.textContent?.trim().length ?? 0
    if (length > bestLength) {
      best = element
      bestLength = length
    }
  }
  return best
}

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'
const FLIGHT_MS = 480
const GIVE_UP_MS = 1500

let pending: Pending | null = null
let giveUpTimer: number | undefined

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function release(): void {
  if (!pending) return
  const { clone, table, source } = pending
  pending = null
  window.clearTimeout(giveUpTimer)
  table?.removeAttribute('data-morph')
  source.style.visibility = ''
  clone
    .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: EASE, fill: 'forwards' })
    .finished.then(() => clone.remove(), () => clone.remove())
}

/**
 * Начать переход с элемента, в котором написано название объекта.
 * Щелчок с модификатором открывает новую вкладку — там переходить некуда.
 */
export function startMorph(
  cell: HTMLElement | null,
  event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; button?: number },
): void {
  if (!cell || reducedMotion()) return
  if (event && (event.metaKey || event.ctrlKey || event.shiftKey || (event.button ?? 0) !== 0)) return

  release()

  const source = titleIn(cell)
  const from = source.getBoundingClientRect()
  const style = window.getComputedStyle(source)
  const clone = document.createElement('div')
  clone.textContent = source.textContent?.trim() ?? ''
  clone.setAttribute('aria-hidden', 'true')
  clone.setAttribute('data-morph-clone', 'true')
  Object.assign(clone.style, {
    position: 'fixed',
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${Math.ceil(from.width) + 1}px`,
    margin: '0',
    font: style.font,
    letterSpacing: style.letterSpacing,
    color: style.color,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    zIndex: '80',
    pointerEvents: 'none',
    transformOrigin: 'left top',
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.appendChild(clone)
  // Название одно: пока летит копия, оригинал в строке скрыт.
  source.style.visibility = 'hidden'

  const table = source.closest('table')
  table?.setAttribute('data-morph', 'true')
  source.closest('tr')?.setAttribute('data-picked', 'true')

  pending = { clone, from, table, source }
  giveUpTimer = window.setTimeout(release, GIVE_UP_MS)
}

/** Приземлить переход на заголовок, если он есть. Вызывает шапка страницы. */
export function landMorph(target: HTMLElement | null): void {
  if (!pending || !target) return
  const { clone, from } = pending
  pending = null
  window.clearTimeout(giveUpTimer)

  const to = target.getBoundingClientRect()
  const fromSize = parseFloat(window.getComputedStyle(clone).fontSize) || 14
  const toSize = parseFloat(window.getComputedStyle(target).fontSize) || fromSize
  const scale = toSize / fromSize

  target.style.opacity = '0'
  const flight = clone.animate(
    [
      { transform: 'translate(0, 0) scale(1)', color: window.getComputedStyle(clone).color },
      {
        transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${scale})`,
        color: window.getComputedStyle(target).color,
      },
    ],
    { duration: FLIGHT_MS, easing: EASE, fill: 'forwards' },
  )

  const finish = () => {
    target.style.opacity = ''
    target.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: EASE })
    clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: EASE, fill: 'forwards' })
      .finished.then(() => clone.remove(), () => clone.remove())
  }
  flight.finished.then(finish, finish)
}
