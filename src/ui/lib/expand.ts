/**
 * Бирка карусели перетекает в страницу объекта (решение 73, data/TagCarousel).
 *
 * Не View Transitions: там браузер замораживает экран, пока новая страница
 * не отрисуется и не получит данные (до ~0,8 с), — после щелчка всё вставало,
 * и переход казался зависанием. Здесь движение не останавливается ни на кадр:
 *
 * 1. поверх бирки проявляется тёмный лист оттенка реестра с мягким светом;
 * 2. лист растёт до рабочей области;
 * 3. под ним меняется страница; когда у новой есть заголовок и нет заготовок,
 *    лист тает, и страница вуза проступает.
 *
 * Анимируются только transform и opacity (WAAPI) — их ведёт видеокарта, и они
 * идут плавно, даже пока главный поток занят сборкой новой страницы.
 * Лист лежит под шапкой и меню: растёт рабочая область, а не весь экран.
 */

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
/** Лист закрывает бирку. */
const COVER_MS = 110
/** Лист растёт до рабочей области. */
const GROW_MS = 560
/** Лист тает, открывая страницу. */
const REVEAL_MS = 380
/** Дольше новую страницу не ждём — лист тает в любом случае. */
const GIVE_UP_MS = 1800

function layer(background: string): HTMLDivElement {
  const element = document.createElement('div')
  Object.assign(element.style, { position: 'absolute', inset: '0', background })
  return element
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/**
 * `tint` — цвет, к которому подмешивается фон листа: у каждого реестра свой
 * оттенок (вузы — фиолетовый, программы — малиновый).
 */
export function expandInto(card: HTMLElement, navigate: () => void, tint = 'var(--accent-violet)'): void {
  const from = card.getBoundingClientRect()
  const main = document.querySelector('main')?.getBoundingClientRect()
  const to = {
    left: Math.max(main?.left ?? 0, 0),
    top: Math.max(main?.top ?? 0, 0),
    right: Math.min(main?.right ?? window.innerWidth, window.innerWidth),
    bottom: window.innerHeight,
  }
  const width = to.right - to.left
  const height = to.bottom - to.top

  const sheet = document.createElement('div')
  sheet.setAttribute('aria-hidden', 'true')
  Object.assign(sheet.style, {
    position: 'fixed',
    left: `${to.left}px`,
    top: `${to.top}px`,
    width: `${width}px`,
    height: `${height}px`,
    // Под шапкой (--z-header: 40) и меню: растёт только рабочая область.
    zIndex: '35',
    pointerEvents: 'none',
    transformOrigin: '0 0',
    willChange: 'transform, opacity',
    contain: 'strict',
  } satisfies Partial<CSSStyleDeclaration>)
  // Тёмно-фиолетовый, близкий к фону сайта: светлый лист, гаснущий в чёрный,
  // мерцал — здесь яркость почти не меняется от начала до конца.
  const violet = layer(
    'radial-gradient(90% 70% at 25% 10%, var(--bg-glow) 0%, transparent 70%),' +
      `color-mix(in srgb, ${tint} 16%, var(--canvas))`,
  )
  sheet.append(violet)
  document.body.appendChild(sheet)

  const start = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / width}, ${from.height / height})`
  const total = COVER_MS + GROW_MS

  // Пока бумага закрывает бирку, лист стоит на её месте (fill: both держит начало).
  sheet.animate([{ transform: start }, { transform: 'none' }], {
    duration: GROW_MS,
    delay: COVER_MS,
    easing: EASE,
    fill: 'both',
  })
  // Лист проявляется поверх бирки и дальше держится до конца роста.
  violet.animate([{ opacity: 0 }, { opacity: 1 }], { duration: COVER_MS + 60, easing: 'ease-out', fill: 'forwards' })

  const oldPage = document.querySelector('[data-page]')
  window.setTimeout(navigate, COVER_MS)

  void (async () => {
    const began = performance.now()
    await sleep(total)
    // Ждём новую страницу с заголовком и без заготовок — иначе лист откроет пустоту.
    while (performance.now() - began < GIVE_UP_MS) {
      const page = document.querySelector('[data-page]')
      if (page && page !== oldPage && page.querySelector('h1') && !page.querySelector('[data-skeleton]')) break
      await sleep(40)
    }
    const reveal = sheet.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: REVEAL_MS,
      easing: 'ease-out',
      fill: 'forwards',
    })
    // Во скрытой вкладке анимации стоят и `finished` не наступает — лист
    // остался бы поверх страницы. Таймер снимает его в любом случае.
    const remove = () => sheet.remove()
    reveal.finished.then(remove, remove)
    window.setTimeout(remove, REVEAL_MS + 120)
  })()
}
