import { UNIVERSITY_STATUS_LABELS, type UniversityListItemDto } from '@/shared/contracts'
import { formatNumber, formatScore } from '@/ui'
import { logoFor } from './university-logos'
import styles from './UniversityTag.module.css'

/*
 * Бирка вуза для 3D-карусели реестра (решение 73): светлая, как багажная бирка
 * в референсе New Zealanderlivery Service.
 */

/** Штрихкод из идентификатора: у каждого вуза свой, одинаковый при каждом показе. */
function barsOf(id: string): number[] {
  const bars: number[] = []
  for (let i = 0; i < 38; i++) {
    const code = id.charCodeAt(i % id.length) + i * 7
    bars.push(1 + (code % 3))
  }
  return bars
}

/** Номер бирки — цифры из идентификатора, как номер на багажной бирке. */
function tagNumber(id: string): string {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return String(hash).padStart(10, '0').slice(0, 10)
}

/** Бирка вуза: как багажная — крупный код, поля с подписями, «фото», штрихкод. */
export function UniversityTag({
  row,
  canSeeAnalytics,
}: {
  row: UniversityListItemDto
  canSeeAnalytics: boolean
}) {
  const code = (row.shortName ?? row.name).toUpperCase()
  const logo = logoFor(row.shortName)
  const score = canSeeAnalytics ? (row.rating?.score ?? null) : null
  return (
    <span className={styles.tag}>
      <span className={styles.hole} aria-hidden />
      <span className={styles.head}>
        <span className={styles.brand}>
          <span className={styles.brandBox}>SL</span>
          <span className={styles.brandName}>SkillLink</span>
        </span>
        <span className={styles.status}>{UNIVERSITY_STATUS_LABELS[row.status]}</span>
      </span>
      {row.isMock && <span className={styles.stamp}>Демо</span>}

      <span className={styles.route}>
        <span className={styles.label}>Вуз:</span>
        <span className={styles.label}>Город:</span>
        <span className={styles.code}>{code}</span>
        <span className={styles.arrow} aria-hidden>
          →
        </span>
        <span className={styles.city}>{row.city}</span>
      </span>

      <span className={styles.field}>
        <span className={styles.label}>Полное название:</span>
        <span className={styles.name} data-card-title>
          {row.name}
        </span>
      </span>

      <span className={styles.field}>
        <span className={styles.label}>Регион:</span>
        <span className={styles.value}>{row.region}</span>
      </span>

      <span className={styles.bottom}>
        {logo ? (
          // Логотип вместо фото — на подложке своего цвета (решение 77).
          <span className={`${styles.photo} ${styles.logoPlate} ${logo.plate === 'dark' ? styles.logoPlateDark : ''}`}>
            {/* Обычный img: файл из public/, оптимизатор Next для шести значков не нужен. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.logo} src={logo.src} alt="" draggable={false} loading="lazy" />
          </span>
        ) : (
          <span className={styles.photo}>{code.slice(0, 4)}</span>
        )}
        <span className={styles.stats}>
          <span className={styles.stat}>
            <span className={styles.label}>Программ</span>
            <span className={styles.statValue}>{formatNumber(row.programCount)}</span>
          </span>
          <span className={styles.stat}>
            <span className={styles.label}>Связки</span>
            <span className={styles.statValue}>
              {formatNumber(row.activeCooperationCount)}/{formatNumber(row.cooperationCount)}
            </span>
          </span>
          {canSeeAnalytics && (
            <span className={styles.stat}>
              <span className={styles.label}>Рейтинг</span>
              <span className={styles.statValue}>{score === null ? <span className={styles.noData}>Нет данных</span> : formatScore(score)}</span>
            </span>
          )}
          <span className={styles.barcode} aria-hidden>
            {barsOf(row.id).map((width, i) => (
              <span key={i} style={{ width: `${width}px` }} className={i % 2 ? styles.gap : styles.bar} />
            ))}
          </span>
          <span className={styles.number} aria-hidden>
            {tagNumber(row.id)}
          </span>
        </span>
      </span>
    </span>
  )
}
