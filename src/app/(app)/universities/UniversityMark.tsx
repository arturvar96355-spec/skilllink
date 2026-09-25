import { Avatar } from '@/ui'
import { logoFor } from './university-logos'
import styles from './UniversityMark.module.css'

/**
 * Знак вуза в ленте реестра (решение 105): настоящий логотип на подложке, где он
 * есть (те же файлы, что на бирках, решение 77), иначе — буквы, как раньше.
 * Реакцию на наведение даёт общий `ListTitle`: знак чуть крупнее и светится.
 */
export function UniversityMark({ name, shortName }: { name: string; shortName: string | null }) {
  const logo = logoFor(shortName)
  if (!logo) return <Avatar name={shortName ?? name} kind="entity" size="sm" />
  return (
    <span className={[styles.plate, logo.plate === 'dark' ? styles.dark : ''].filter(Boolean).join(' ')}>
      {/* Обычный img: файл из public/, оптимизатор Next для шести значков не нужен. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.logo} src={logo.src} alt="" draggable={false} loading="lazy" />
    </span>
  )
}
