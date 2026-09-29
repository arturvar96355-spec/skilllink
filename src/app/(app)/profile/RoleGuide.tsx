import Link from 'next/link'
import type { CSSProperties } from 'react'
import { Icon } from '@/ui'
import type { RoleGuide as RoleGuideData } from './profile-role'
import styles from './profile.module.css'

/**
 * Блок роли (решение 236): вместо нулей «Ваша работа» у того, кто не ведёт связки, —
 * разделы роли строками. У эксперта строки пронумерованы: это маршрут проверки,
 * и порядок в нём значим; у сотрудника — просто куда идти.
 */
export function RoleGuide({ guide, id }: { guide: RoleGuideData; id: string }) {
  const List = guide.ordered ? 'ol' : 'ul'
  return (
    <section className={styles.block} aria-labelledby={id}>
      <div className={styles.blockHead}>
        <h2 id={id} className={styles.blockTitle}>
          {guide.title}
        </h2>
        <span className={styles.blockNote}>{guide.note}</span>
      </div>
      <List className={styles.guide}>
        {guide.links.map((link, index) => (
          <li key={`${link.href}:${link.label}`} className={styles.guideItem} style={{ '--i': index } as CSSProperties}>
            <Link className={styles.guideLink} href={link.href}>
              <span className={styles.guideMark} aria-hidden>
                {guide.ordered ? index + 1 : <Icon name={link.icon} size={18} />}
              </span>
              <span className={styles.guideText}>
                <span className={styles.guideLabel}>{link.label}</span>
                <span className={styles.guideCaption}>{link.caption}</span>
              </span>
              <Icon name="arrowRight" size={16} className={styles.guideArrow} aria-hidden />
            </Link>
          </li>
        ))}
      </List>
    </section>
  )
}
