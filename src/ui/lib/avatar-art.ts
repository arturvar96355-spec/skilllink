/**
 * Сгенерированный портрет сотрудника (решение 230).
 *
 * Настоящих фотографий в системе нет и не будет: адреса картинок не хранятся, а
 * тянуть лица с чужих сайтов нельзя (CSP и персональные данные). Поэтому у каждого
 * сотрудника — рисунок-набросок: голова, причёска, глаза, брови, нос, рот, иногда
 * очки или борода, плечи с воротом. Рисунок собирается из заранее нарисованных
 * деталей по идентификатору пользователя — один и тот же человек всегда выглядит
 * одинаково, на любом экране и после перезагрузки, без запросов наружу.
 *
 * Здесь — только геометрия и выбор деталей, без цветов: цвет даёт `Avatar.module.css`
 * переменными из `globals.css` (набросок — чернилами по бумаге в любой теме, подложка —
 * приглушённым акцентом на цвете поверхности, в рабочем режиме — нейтральная).
 *
 * Отчество подсказывает только одно: бороды у сотрудниц не бывает, длинные
 * причёски чаще у них же. Без отчества (учётные записи с ярлыком роли) — любые детали.
 */

/** Приглушённые акценты палитры; в рабочем режиме они и так сводятся к нейтральному. */
export const AVATAR_TONES = ['violet', 'cyan', 'pink', 'orange'] as const
export type AvatarTone = (typeof AVATAR_TONES)[number]

/** Чем закрашивается деталь — класс в `Avatar.module.css`. */
export type AvatarInk =
  /** Лицо, шея, уши: светлая «бумага» с контуром. */
  | 'skin'
  /** Одежда: тон аватара с контуром. */
  | 'cloth'
  /** Волосы и борода: сплошная заливка цветом линий. */
  | 'hair'
  /** Короткая стрижка и щетина: та же заливка, но прозрачнее. */
  | 'soft'
  /** Черты лица, ворот, оправа очков: только линия. */
  | 'line'
  /** Зрачки: маленькая заливка цветом линий. */
  | 'dot'
  /** Рот поверх густой бороды: линия цветом кожи. */
  | 'lineOnHair'

export type AvatarShape =
  | { type: 'path'; ink: AvatarInk; d: string }
  | { type: 'circle'; ink: AvatarInk; cx: number; cy: number; r: number }
  | { type: 'ellipse'; ink: AvatarInk; cx: number; cy: number; rx: number; ry: number }
  | { type: 'rect'; ink: AvatarInk; x: number; y: number; width: number; height: number; rx: number }

export interface AvatarArt {
  tone: AvatarTone
  /** Детали в порядке рисования: то, что ниже по списку, лежит сверху. */
  shapes: AvatarShape[]
  /** Какие варианты выпали — для тестов и отладки. */
  traits: {
    head: number
    hair: HairStyle
    eyes: number
    brows: number
    nose: number
    mouth: number
    glasses: 'none' | 'round' | 'square'
    beard: 'none' | 'stubble' | 'full'
    collar: number
  }
}

export type HairStyle = 'crop' | 'side' | 'quiff' | 'buzz' | 'bob' | 'long' | 'bun' | 'ponytail' | 'curly'

type Presentation = 'female' | 'male' | 'unknown'

/** FNV-1a, 32 бита: быстрый, без зависимостей, одинаковый в браузере и на сервере. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32: из одного числа — последовательность «случайных», но повторяемых чисел. */
function sequence(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(next: () => number, items: readonly T[]): T {
  return items[Math.floor(next() * items.length)]!
}

/** «Фамилия Имя Отчество»: отчество на -вна/-чна — женщина, на -ич — мужчина. */
export function presentationOf(fullName: string): Presentation {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length < 3) return 'unknown'
  const patronymic = parts[parts.length - 1]!.toLowerCase()
  if (/(вна|чна|кызы)$/.test(patronymic)) return 'female'
  if (/(ич|оглы)$/.test(patronymic)) return 'male'
  return 'unknown'
}

const HAIR_BY_PRESENTATION: Record<Presentation, readonly HairStyle[]> = {
  // Повторы — вес: длинные и собранные причёски у сотрудниц встречаются чаще.
  female: ['bob', 'bob', 'long', 'long', 'bun', 'ponytail', 'curly', 'side'],
  male: ['crop', 'crop', 'side', 'side', 'quiff', 'buzz', 'curly'],
  unknown: ['crop', 'side', 'quiff', 'buzz', 'bob', 'long', 'bun', 'ponytail', 'curly'],
}

const HEAD_RX = [11.6, 12.4, 13] as const

/* Волосы сзади головы — рисуются до неё. */
const BACK_HAIR: Partial<Record<HairStyle, AvatarShape[]>> = {
  long: [{ type: 'path', ink: 'hair', d: 'M17.5 50C14 36 16 14.5 32 14.5S50 36 46.5 50Z' }],
  bun: [{ type: 'circle', ink: 'hair', cx: 32, cy: 11.6, r: 5.4 }],
  ponytail: [{ type: 'path', ink: 'hair', d: 'M40.5 18.5C50.5 19 53 31.5 49 43C47.6 36.5 45.6 30.5 42.4 26.5Z' }],
}

/* Волосы спереди — поверх головы. */
const FRONT_HAIR: Record<HairStyle, AvatarShape[]> = {
  crop: [
    {
      type: 'path',
      ink: 'hair',
      d: 'M19.2 29C18 19.5 24 14.5 32 14.5S46 19.5 44.8 29C44 25 42.5 22.5 40 21.5C35 23.5 27 23.5 23.5 21.5C21.5 23 20 25.5 19.2 29Z',
    },
  ],
  side: [
    {
      type: 'path',
      ink: 'hair',
      d: 'M19.2 30C17.5 19 24.5 13.5 33 14S46.5 20 44.8 30C44.2 25.5 42.5 22 39.5 20.5C34 24 25.5 25 19.2 30Z',
    },
  ],
  quiff: [
    {
      type: 'path',
      ink: 'hair',
      d: 'M19.3 28C18.5 19 22 13 30 11.5C36 10.5 42 12 44 16S45.5 24.5 44.8 28C43.5 23.5 41 21 37 20.5C31 20 24 22 19.3 28Z',
    },
  ],
  buzz: [
    {
      type: 'path',
      ink: 'soft',
      d: 'M19.6 27C19.6 19.5 25 15.4 32 15.4S44.4 19.5 44.4 27C41 22.5 37 21 32 21S23 22.5 19.6 27Z',
    },
  ],
  bob: [
    {
      type: 'path',
      ink: 'hair',
      d: 'M18 40C15.5 26 20 14 32 14S48.5 26 46 40H42.8C43.5 34 43.8 28 42 23.5C36 23 29 21 24 19.5C21 23 20.5 32 21.2 40Z',
    },
  ],
  long: [
    {
      type: 'path',
      ink: 'hair',
      d: 'M19.4 29C19 19.5 25 14.8 32 14.8S45 19.5 44.6 29C42 24 38.5 21.5 34 21C33 23.5 29 25.5 24 25.5C22 26.5 20.5 27.5 19.4 29Z',
    },
  ],
  bun: [
    {
      type: 'path',
      ink: 'hair',
      d: 'M19.4 28C19 19.5 25 15 32 15S45 19.5 44.6 28C41.5 23 37 21 32 21S22.5 23 19.4 28Z',
    },
  ],
  ponytail: [
    {
      type: 'path',
      ink: 'hair',
      d: 'M19.2 30C17.5 19 24.5 13.5 33 14S46.5 20 44.8 30C44.2 25.5 42.5 22 39.5 20.5C34 24 25.5 25 19.2 30Z',
    },
  ],
  curly: [
    { type: 'path', ink: 'hair', d: 'M20 27C20 20 25 16 32 16S44 20 44 27Z' },
    { type: 'circle', ink: 'hair', cx: 20.6, cy: 26, r: 3.8 },
    { type: 'circle', ink: 'hair', cx: 22.2, cy: 19.6, r: 4.2 },
    { type: 'circle', ink: 'hair', cx: 27, cy: 15.6, r: 4.4 },
    { type: 'circle', ink: 'hair', cx: 33, cy: 14.2, r: 4.5 },
    { type: 'circle', ink: 'hair', cx: 39, cy: 15.8, r: 4.4 },
    { type: 'circle', ink: 'hair', cx: 43, cy: 20, r: 4.2 },
    { type: 'circle', ink: 'hair', cx: 43.6, cy: 26, r: 3.8 },
  ],
}

const EYES: ReadonlyArray<AvatarShape[]> = [
  [
    { type: 'circle', ink: 'dot', cx: 27.2, cy: 31, r: 1.35 },
    { type: 'circle', ink: 'dot', cx: 36.8, cy: 31, r: 1.35 },
  ],
  [
    { type: 'ellipse', ink: 'dot', cx: 27.2, cy: 31, rx: 1.1, ry: 1.65 },
    { type: 'ellipse', ink: 'dot', cx: 36.8, cy: 31, rx: 1.1, ry: 1.65 },
  ],
  [
    { type: 'path', ink: 'line', d: 'M25.6 31.6Q27.2 29.8 28.8 31.6' },
    { type: 'path', ink: 'line', d: 'M35.2 31.6Q36.8 29.8 38.4 31.6' },
  ],
]

const BROWS: ReadonlyArray<AvatarShape[]> = [
  [{ type: 'path', ink: 'line', d: 'M25 26.8H29.4M34.6 26.8H39' }],
  [{ type: 'path', ink: 'line', d: 'M25 27.2Q27.2 25.4 29.4 26.8M34.6 26.8Q36.8 25.4 39 27.2' }],
  [{ type: 'path', ink: 'line', d: 'M25.4 26.6Q27.2 25.8 29 26.4M35 26.4Q36.8 25.8 38.6 26.6' }],
  [{ type: 'path', ink: 'line', d: 'M25 26Q27.2 24.6 29.4 25.6M34.6 26.8H39' }],
]

const NOSES: ReadonlyArray<AvatarShape> = [
  { type: 'path', ink: 'line', d: 'M32.4 31.5L31 36H33.2' },
  { type: 'path', ink: 'line', d: 'M33 31.5Q29.8 35.8 32.6 36.4' },
  { type: 'path', ink: 'line', d: 'M30.6 35.6Q32 37 33.4 35.6' },
]

const MOUTHS: readonly string[] = [
  'M28.6 39Q32 42 35.4 39',
  'M29.6 40H34.4',
  'M28.8 38.8Q32 43 35.2 38.8Z',
  'M29.2 40.2Q32.6 41.2 35.2 38.8',
]

const COLLARS: readonly string[] = [
  'M27 49.6C28.5 53 35.5 53 37 49.6',
  'M27 49.6L32 56L37 49.6',
  'M27 49.6L30 54.5L32 51L34 54.5L37 49.6M32 51V64',
]

const GLASSES: Record<'round' | 'square', AvatarShape[]> = {
  round: [
    { type: 'circle', ink: 'line', cx: 27.2, cy: 31, r: 3.5 },
    { type: 'circle', ink: 'line', cx: 36.8, cy: 31, r: 3.5 },
    { type: 'path', ink: 'line', d: 'M30.7 30.6Q32 29.8 33.3 30.6M23.7 30.5L20.4 29.7M40.3 30.5L43.6 29.7' },
  ],
  square: [
    { type: 'rect', ink: 'line', x: 23.4, y: 28.2, width: 7.6, height: 5.6, rx: 1.6 },
    { type: 'rect', ink: 'line', x: 33, y: 28.2, width: 7.6, height: 5.6, rx: 1.6 },
    { type: 'path', ink: 'line', d: 'M31 30.4H33M23.4 30.2L20.4 29.6M40.6 30.2L43.6 29.6' },
  ],
}

const BEARDS: Record<'stubble' | 'full', AvatarShape> = {
  stubble: {
    type: 'path',
    ink: 'soft',
    d: 'M20.2 33C20.5 41 25.5 45 32 45S43.5 41 43.8 33C42 38 38 40 32 40.5C26 40 22 38 20.2 33Z',
  },
  full: {
    type: 'path',
    ink: 'hair',
    d: 'M19.8 31C19.5 41 25 46.5 32 46.5S44.5 41 44.2 31C43 35 41 37.5 38 37.8C36 36.8 34 36.4 32 36.4S28 36.8 26 37.8C23 37.5 21 35 19.8 31Z',
  },
}

/**
 * Портрет по идентификатору пользователя. `fullName` — только подсказка для
 * бороды и причёски; сам рисунок держится на `seed`: сменили ФИО — лицо то же.
 */
export function avatarArt(seed: string, fullName = ''): AvatarArt {
  const next = sequence(hashSeed(seed))
  const presentation = presentationOf(fullName)

  // Порядок вызовов `next()` фиксирован: новый вариант детали добавляется в конец
  // списка, а не в середину, — иначе у всех разом поменяются лица.
  const tone = pick(next, AVATAR_TONES)
  const head = Math.floor(next() * HEAD_RX.length)
  const hair = pick(next, HAIR_BY_PRESENTATION[presentation])
  const eyes = Math.floor(next() * EYES.length)
  const brows = Math.floor(next() * BROWS.length)
  const nose = Math.floor(next() * NOSES.length)
  const mouth = Math.floor(next() * MOUTHS.length)
  const collar = Math.floor(next() * COLLARS.length)
  const glassesRoll = next()
  const beardRoll = next()

  const glasses = glassesRoll < 0.18 ? 'round' : glassesRoll < 0.32 ? 'square' : 'none'
  const beard =
    presentation !== 'male' ? 'none' : beardRoll < 0.2 ? 'full' : beardRoll < 0.42 ? 'stubble' : 'none'

  const rx = HEAD_RX[head]!
  const shapes: AvatarShape[] = [
    ...(BACK_HAIR[hair] ?? []),
    { type: 'path', ink: 'cloth', d: 'M9 64C9 55.5 16 50.5 25 49.5H39C48 50.5 55 55.5 55 64Z' },
    { type: 'path', ink: 'skin', d: 'M28.5 40V49.6H35.5V40' },
    { type: 'ellipse', ink: 'skin', cx: 32 - rx, cy: 31.5, rx: 2.2, ry: 3 },
    { type: 'ellipse', ink: 'skin', cx: 32 + rx, cy: 31.5, rx: 2.2, ry: 3 },
    { type: 'ellipse', ink: 'skin', cx: 32, cy: 30, rx, ry: 14 },
    ...(beard === 'none' ? [] : [BEARDS[beard]]),
    ...FRONT_HAIR[hair],
    ...BROWS[brows]!,
    ...EYES[eyes]!,
    NOSES[nose]!,
    { type: 'path', ink: beard === 'full' ? 'lineOnHair' : 'line', d: MOUTHS[mouth]! },
    ...(glasses === 'none' ? [] : GLASSES[glasses]),
    { type: 'path', ink: 'line', d: COLLARS[collar]! },
  ]

  return {
    tone,
    shapes,
    traits: { head, hair, eyes, brows, nose, mouth, glasses, beard, collar },
  }
}
