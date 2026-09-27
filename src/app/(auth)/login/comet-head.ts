/**
 * Где стоит голова кометы на экране входа (решения 199 и 208).
 *
 * Голова — выше и левее знака SkillLink, над его значком. Жалоба: в невысоком
 * окне (видно 570–620 px, например 1280×720 с панелями браузера) голова ложилась
 * на знак: её высота была `max(96, верх знака − 150)`, и нижняя граница 96 px
 * от края экрана перебивала условие «выше знака» — при верхе знака на 91 px
 * голова вставала прямо на значок.
 *
 * Теперь условие «выше знака с зазором» главное:
 * 1. Как раньше: на 150 px выше строки знака, не ближе 96 px к верху окна.
 * 2. Но край свечения головы — не ниже, чем за HEAD_GAP до верха строки знака,
 *    с запасом на покачивание сцены за курсором. Ради этого голова поднимается
 *    ближе к верху окна (не ближе своего радиуса и ещё 16 px).
 * 3. Места нет и так — голова вместе со своим облаком сжимается (не меньше
 *    HEAD_MIN_SCALE): меньше свечение — ниже может стоять центр.
 * 4. Нет и тогда — голова встаёт правее подписи знака, на уровне его строки,
 *    а не на сам знак.
 */

/**
 * Радиус свечения головы, доля высоты окна: ядро — точка 1,4 единицы мира на
 * глубине 15,5 при угле камеры 55°, диаметр около 4,5 % высоты окна.
 */
export const HEAD_RADIUS = 0.023
/** Зазор между краем свечения головы и верхом строки знака, px. */
export const HEAD_GAP = 24
/** Голова целиком в окне и не в самом краю: от верха не ближе радиуса и ещё этого, px. */
export const HEAD_TOP_INSET = 16
/** Как раньше: голова на столько выше строки знака и не ближе EDGE_MARGIN к краю. */
export const HEAD_LIFT = 150
export const EDGE_MARGIN = 96
/**
 * Покачивание сцены за курсором (курсор слева вверху) отводит голову от камеры,
 * и она съезжает к центру экрана — вниз, к знаку — до ~12 % своего расстояния
 * от центра по высоте (поворот мира до 0,10 рад при голове в 17 единицах от оси).
 */
export const HEAD_SWAY = 0.12
/** Меньше голова не сжимается. */
export const HEAD_MIN_SCALE = 0.55

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface HeadPlacement {
  x: number
  y: number
  /** Масштаб головы и её облака: 1 — как задумано, меньше — в тесном окне. */
  scale: number
}

/** Самый низкий центр головы, при котором её свечение (с покачиванием) не заходит на знак. */
function lowestAbove(brandTop: number, height: number, radius: number): number {
  // y + radius + HEAD_GAP + HEAD_SWAY * (height / 2 − y) ≤ brandTop
  return (brandTop - radius - HEAD_GAP - (HEAD_SWAY * height) / 2) / (1 - HEAD_SWAY)
}

/**
 * @param brand строка знака (значок и подпись), пиксели окна
 * @param brandText подпись знака («SkillLink», «Вузы × IT-компании»)
 */
export function placeHead(brand: Box, brandText: Box | null, width: number, height: number): HeadPlacement {
  const x = Math.max(EDGE_MARGIN, Math.round(brand.left + 48))
  const wanted = Math.max(EDGE_MARGIN, brand.top - HEAD_LIFT)
  const full = HEAD_RADIUS * height

  // 1–2. Полный размер: выше знака с зазором, если надо — ближе к верху окна.
  const highest = full + HEAD_TOP_INSET
  const lowest = lowestAbove(brand.top, height, full)
  if (lowest >= highest) return { x, y: Math.round(Math.min(wanted, lowest)), scale: 1 }

  // 3. Сжать: центр на `radius + inset`, свечение с запасом — над знаком.
  // (1 − s)·(r·k + inset) + r·k ≤ brandTop − gap − sway·h/2, где r·k — радиус при масштабе k.
  const budget = brand.top - HEAD_GAP - (HEAD_SWAY * height) / 2 - (1 - HEAD_SWAY) * HEAD_TOP_INSET
  const scale = budget / (full * (2 - HEAD_SWAY))
  if (scale >= HEAD_MIN_SCALE) {
    return { x, y: Math.round(full * scale + HEAD_TOP_INSET), scale: Math.min(1, scale) }
  }

  // 4. Над знаком места нет: правее подписи знака, на уровне его строки. Покачивание
  // уводит голову от центра — влево, к подписи: запас на него тот же.
  // x − r − sway·(width/2 − x) ≥ textRight + gap
  const small = full * HEAD_MIN_SCALE
  const textRight = brandText?.right ?? brand.left + 180
  const aside = (textRight + HEAD_GAP + small + (HEAD_SWAY * width) / 2) / (1 + HEAD_SWAY)
  return {
    x: Math.ceil(Math.min(width * 0.3, aside)),
    y: Math.round((brand.top + brand.bottom) / 2),
    scale: HEAD_MIN_SCALE,
  }
}
