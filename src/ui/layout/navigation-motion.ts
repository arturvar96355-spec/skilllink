'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * Переход «карточка раскрывается в свою страницу» (06, разделы 17–18; 07, раздел 9).
 *
 * Только для объектов: строки реестров и плашки, у которых помечено название
 * (`data-morph-title`). Меню, шапка, кнопки и ссылки разделов переходят сразу —
 * по ним человек ходит десятки раз в день, и ждать там нечего.
 *
 * Сделан на View Transitions: браузер снимает старый и новый экран и анимирует
 * снимки на видеокарте — разметка не клонируется, на кадре ничего не
 * перерисовывается. Хореография (постоянная часть — в globals.css):
 *
 * 1. Список расступается в месте щелчка: строки выше уходят вверх, ниже — вниз,
 *    остальная страница отступает вглубь и гаснет.
 * 2. Нажатая плашка вырастает из своих границ в страницу объекта — со светом
 *    по краю, пока растёт, — и внутри неё проявляется карточка.
 * 3. Название из строки перелетает в заголовок карточки.
 *
 * Навигация начинается сразу (06, раздел 16). Экран держит старый снимок, пока
 * новая страница не отрисуется, но не дольше `COMMIT_WAIT_MS`: если её нет
 * (в разработке первая сборка страницы идёт секунды), переход не зависает —
 * старый экран отпускается, и новая страница приходит обычным появлением.
 *
 * Без поддержки View Transitions и при «уменьшить движение» всё работает
 * по-старому: ссылка переходит сама, блоки появляются по очереди.
 */

/** Отметка на корне документа: идёт переход, свой перелёт названия (lib/morph) не нужен. */
export const NAV_TRANSITION_ATTRIBUTE = 'data-nav-transition'

/** Сколько экран держит старый снимок в ожидании новой страницы. */
const COMMIT_WAIT_MS = 500
/**
 * Сколько ждать, пока новая страница получит данные: у карточек с ними приходит
 * заголовок, и заготовки сменяются настоящими блоками.
 */
const SETTLE_WAIT_MS = 260
const STYLE_ID = 'nav-transition-choreography'

/** Расхождение списка. */
const PART_MS = 460
const PART_EASE = 'cubic-bezier(0.5, 0, 0.2, 1)'
/** Сколько соседних строк по каждую сторону расступаются отдельно; дальние — вместе с экраном. */
const PART_NEIGHBOURS = 8

interface Destination {
  href: string
  /** Плашка, которая раскрывается в страницу: строка реестра или ссылка-плашка. */
  card: HTMLElement
  /** Название, которое перелетает в заголовок. */
  title: HTMLElement
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function isPlainClick(event: MouseEvent): boolean {
  return (
    event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
  )
}

/**
 * Карточка объекта, на которую щёлкнули, и куда она ведёт.
 *
 * Карточка — это строка реестра со ссылкой или ссылка, внутри которой помечено
 * название (`data-morph-title`). Всё остальное — меню, кнопки, хлебные крошки —
 * переходом не считается.
 */
function destinationOf(target: Element): Destination | null {
  if (target.closest('[data-nav-chrome]')) return null
  const control = target.closest('button, input, select, textarea, label, summary, [role="button"]')
  const anchor = target.closest<HTMLAnchorElement>('a[href]')
  const row = target.closest<HTMLElement>('tbody tr')
  const card = row ?? anchor
  if (!card) return null

  const link = anchor ?? row?.querySelector<HTMLAnchorElement>('a[href]') ?? null
  if (!link) return null
  // Кнопка внутри строки делает своё дело, а не открывает строку.
  if (control && !link.contains(control) && !control.contains(link)) return null
  if (link.target && link.target !== '_self') return null
  if (link.hasAttribute('download')) return null

  const title = card.querySelector<HTMLElement>('[data-morph-title]')
  // Ссылка без помеченного названия — не карточка объекта, а переход по разделу.
  if (!row && !title) return null

  const url = new URL(link.href, window.location.href)
  if (url.origin !== window.location.origin) return null
  if (url.pathname === window.location.pathname) return null
  if (url.pathname.startsWith('/api/')) return null

  return {
    href: url.pathname + url.search + url.hash,
    card,
    title: title ?? link,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/**
 * Ждёт условия, опрашивая таймером: пока идёт переход, отрисовка документа
 * приостановлена, и requestAnimationFrame не вызывается.
 */
async function waitFor<T>(probe: () => T | null, ms: number): Promise<T | null> {
  const deadline = performance.now() + ms
  for (;;) {
    const found = probe()
    if (found || performance.now() >= deadline) return found
    await sleep(16)
  }
}

/**
 * Соседи плашки в её списке — строки таблицы или пункты ленты. Ближние по
 * обе стороны расступаются отдельными слоями.
 */
function neighboursOf(card: HTMLElement): Array<{ element: HTMLElement; offset: number }> {
  const item = card.matches('tr, li') ? card : (card.closest<HTMLElement>('li') ?? card)
  const list = item.parentElement
  if (!list) return []
  const siblings = Array.from(list.children) as HTMLElement[]
  const index = siblings.indexOf(item)
  if (index === -1) return []
  return siblings
    .map((element, position) => ({ element, offset: position - index }))
    .filter(({ offset }) => offset !== 0 && Math.abs(offset) <= PART_NEIGHBOURS)
}

/**
 * Хореография, посчитанная от нажатой плашки: куда расступаются соседи.
 * Кладётся на время перехода и убирается после.
 */
function writeDeparture(neighbours: Array<{ name: string; offset: number }>): void {
  document.getElementById(STYLE_ID)?.remove()
  const style = document.createElement('style')
  style.id = STYLE_ID

  const rules = neighbours.map(({ name, offset }) => {
    // Ближние уходят первыми и дальше всех: список раздвигается от места щелчка.
    const distance = Math.abs(offset)
    const shift = Math.sign(offset) * (140 + 36 * (PART_NEIGHBOURS - distance))
    return `
      @keyframes ${name} {
        0% { transform: none; opacity: 1; }
        100% { transform: translateY(${shift}px) scale(0.96); opacity: 0; }
      }
      ::view-transition-old(${name}) {
        animation: ${name} ${PART_MS}ms ${PART_EASE} ${(distance - 1) * 22}ms both;
      }`
  })
  style.textContent = rules.join('\n')
  document.head.appendChild(style)
}

export interface NavigationMotion {
  /** Идёт переход: каркас показывает линию под шапкой. */
  isLeaving: boolean
}

/** Подключается каркасом один раз. */
export function useNavigationMotion(pathname: string): NavigationMotion {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  // С какой страницы ушли: новая страница признака не наследует даже на кадр.
  const [leavingFrom, setLeavingFrom] = useState<string | null>(null)
  // Кто ждёт отрисовки новой страницы.
  const waiters = useRef<Array<() => void>>([])

  useEffect(() => {
    setLeavingFrom(null)
    const pending = waiters.current
    waiters.current = []
    pending.forEach((resolve) => resolve())
  }, [pathname])

  useEffect(() => {
    function waitForCommit(): Promise<boolean> {
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => resolve(false), COMMIT_WAIT_MS)
        waiters.current.push(() => {
          window.clearTimeout(timer)
          resolve(true)
        })
      })
    }

    function run({ href, card, title }: Destination) {
      const root = document.documentElement
      root.setAttribute(NAV_TRANSITION_ATTRIBUTE, '')

      const named: HTMLElement[] = []
      const name = (element: Element, value: string) => {
        const target = element as HTMLElement
        target.style.setProperty('view-transition-name', value)
        named.push(target)
      }
      const unname = () => {
        named.forEach((element) => element.style.removeProperty('view-transition-name'))
        named.length = 0
      }

      // Меню, шапка и поиск — своими слоями над движением: иначе раскрывающаяся
      // карточка на миг ложилась бы на них. Имена живут весь переход — в старом
      // и новом экране это те же элементы.
      const chrome = Array.from(document.querySelectorAll<HTMLElement>('[data-nav-chrome]'))
      chrome.forEach((element) =>
        element.style.setProperty('view-transition-name', `nav-chrome-${element.dataset.navChrome}`),
      )

      // Старый экран: плашка — отдельно, название в ней — отдельно,
      // соседи — каждый своим слоем. Остальное отступает вместе с экраном.
      name(card, 'nav-card')
      if (title !== card) name(title, 'nav-source')
      const neighbours = neighboursOf(card).map(({ element, offset }, index) => {
        const value = `nav-part-${index}`
        name(element, value)
        return { name: value, offset }
      })
      writeDeparture(neighbours)

      const transition = document.startViewTransition(async () => {
        routerRef.current.push(href)
        const committed = await waitForCommit()
        // Старые имена снимаются: иначе с именами новой страницы вышло бы
        // два элемента на одно имя, и браузер сорвал бы переход.
        unname()
        if (!committed) return

        const page = document.querySelector<HTMLElement>('[data-page]')
        if (!page) return
        // Появление новой страницы ведёт переход — собственное CSS-появление не нужно.
        page.setAttribute('data-vt', '')
        // Ждём данных: элемент, взятый в переход, не должен исчезнуть посреди
        // анимации — браузер обрывает её целиком. Заготовки сменяются данными
        // вместе с заголовком карточки.
        await waitFor(
          () => (page.querySelector('h1') && !page.querySelector('[data-skeleton]') ? true : null),
          SETTLE_WAIT_MS,
        )
        // Ещё два кадра: эффекты пришедших данных (прокрутка к этапу по ссылке)
        // должны отработать до снимка, а не внутри раскрывающейся плашки.
        await sleep(32)
        // Новый экран: рабочая область — это раскрывшаяся плашка, заголовок —
        // долетевшее название. Область, а не сама страница: у области есть поля,
        // и скруглённые углы растущей плашки не срезают края содержимого.
        name(page.closest('main') ?? page, 'nav-card')
        const heading = page.querySelector('h1')
        if (heading) name(heading, 'nav-source')
      })

      const cleanup = () => {
        unname()
        chrome.forEach((element) => element.style.removeProperty('view-transition-name'))
        document.getElementById(STYLE_ID)?.remove()
        root.removeAttribute(NAV_TRANSITION_ATTRIBUTE)
      }
      transition.finished.then(cleanup, cleanup)
    }

    function onClick(event: MouseEvent) {
      if (!isPlainClick(event)) return
      if (!(event.target instanceof Element)) return
      const destination = destinationOf(event.target)
      if (!destination) return

      setLeavingFrom(window.location.pathname)
      if (typeof document.startViewTransition !== 'function' || reducedMotion()) return
      if (document.documentElement.hasAttribute(NAV_TRANSITION_ATTRIBUTE)) return

      // Переход ведём сами: `Link` и строка таблицы, увидев отменённый щелчок,
      // навигацию не запускают — её запустит переход в нужный момент.
      event.preventDefault()
      run(destination)
    }

    // Фаза перехвата — раньше обработчиков ссылок и строк.
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  return { isLeaving: leavingFrom !== null && leavingFrom === pathname }
}
