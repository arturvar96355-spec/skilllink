import { memo } from 'react'
import { avatarArt, type AvatarArt, type AvatarShape } from '../lib/avatar-art'
import { abbreviate, initials } from '../lib/format'
import styles from './Avatar.module.css'

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl'

export interface AvatarProps {
  name: string
  size?: AvatarSize
  /** Объект (вуз, программа, продукт), а не человек: другая подача инициалов. */
  kind?: 'person' | 'entity'
  /**
   * Идентификатор пользователя (решение 230): с ним вместо инициалов — сгенерированный
   * портрет, один и тот же для человека на любом экране. Без него — инициалы:
   * контакты вуза и всё, у чего нет учётной записи, остаются буквами.
   */
  seed?: string | null
  /**
   * Подпись для чтения с экрана. Без неё аватар декоративный: рядом всегда стоит
   * имя, и повторять его незачем. С ней — картинка с подписью (крупный аватар профиля).
   */
  label?: string
}

/*
 * Мелкий аватар показывает лицо крупным планом, крупный — с плечами: на 20 пикселях
 * плечи съедали бы половину круга, а в профиле без них портрет выглядит обрезанным.
 */
const VIEW_BOX: Record<AvatarSize, string> = {
  xs: '14 10 36 36',
  sm: '14 10 36 36',
  md: '10 6 44 44',
  lg: '4 2 56 56',
  xl: '3 1 58 58',
  xxl: '2 0 60 60',
}

function Shape({ shape }: { shape: AvatarShape }) {
  const className = styles[shape.ink]
  switch (shape.type) {
    case 'path':
      return <path className={className} d={shape.d} />
    case 'circle':
      return <circle className={className} cx={shape.cx} cy={shape.cy} r={shape.r} />
    case 'ellipse':
      return <ellipse className={className} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} />
    case 'rect':
      return (
        <rect className={className} x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} />
      )
  }
}

/*
 * Рисунок зависит только от идентификатора и имени: в длинных списках строка
 * перерисовывается чаще, чем меняется человек в ней. Кэш ограничен — сотрудников
 * в системе десятки, а не тысячи; переполнился — начинаем заново.
 */
const ART_CACHE = new Map<string, AvatarArt>()
const ART_CACHE_LIMIT = 500

function artFor(seed: string, name: string): AvatarArt {
  const key = `${seed}\u0000${name}`
  const cached = ART_CACHE.get(key)
  if (cached) return cached
  if (ART_CACHE.size >= ART_CACHE_LIMIT) ART_CACHE.clear()
  const art = avatarArt(seed, name)
  ART_CACHE.set(key, art)
  return art
}

const Portrait = memo(function Portrait({ art, size }: { art: AvatarArt; size: AvatarSize }) {
  return (
    <svg viewBox={VIEW_BOX[size]} className={styles.svg} focusable="false" aria-hidden="true">
      {art.shapes.map((shape, index) => (
        <Shape key={index} shape={shape} />
      ))}
    </svg>
  )
})

/**
 * Аватар: сгенерированный портрет сотрудника или инициалы.
 *
 * Настоящих фотографий и логотипов в данных нет: адреса картинок система не хранит.
 * Придумывать их и тянуть с чужих сайтов нельзя — на защите это отвалится
 * при первом же отсутствии сети. Сотрудникам (есть `seed`) рисуем портрет-набросок
 * локально (`lib/avatar-art.ts`), сущностям — узнаваемую аббревиатуру.
 */
export function Avatar({ name, size = 'md', kind = 'person', seed, label }: AvatarProps) {
  const isPortrait = kind === 'person' && Boolean(seed)
  const classes = [
    styles.avatar,
    styles[size],
    kind === 'entity' ? styles.entity : '',
    isPortrait ? styles.portrait : '',
  ]
    .filter(Boolean)
    .join(' ')
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const }

  if (isPortrait) {
    const art = artFor(seed!, name)
    return (
      <span className={classes} data-tone={art.tone} title={`${name} — сгенерированный аватар`} {...a11y}>
        <Portrait art={art} size={size} />
      </span>
    )
  }

  const text = kind === 'person' ? initials(name) : abbreviate(name)
  return (
    <span className={classes} title={name} {...a11y}>
      {text}
    </span>
  )
}
