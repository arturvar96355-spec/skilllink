import { abbreviate, initials } from '../lib/format'
import styles from './Avatar.module.css'

export interface AvatarProps {
  name: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Объект (вуз, программа, продукт), а не человек: другая подача инициалов. */
  kind?: 'person' | 'entity'
}

/**
 * Инициалы вместо изображения.
 *
 * Настоящих логотипов вузов в данных нет: адреса картинок система не хранит.
 * Придумывать их и тянуть с чужих сайтов нельзя — на защите это отвалится
 * при первом же отсутствии сети, поэтому берём узнаваемую аббревиатуру.
 */
export function Avatar({ name, size = 'md', kind = 'person' }: AvatarProps) {
  const text = kind === 'person' ? initials(name) : abbreviate(name)
  return (
    <span
      className={[styles.avatar, styles[size], kind === 'entity' ? styles.entity : '']
        .filter(Boolean)
        .join(' ')}
      title={name}
      aria-hidden="true"
    >
      {text}
    </span>
  )
}
