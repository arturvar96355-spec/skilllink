import Link from 'next/link'
import type { NavGroup, ServiceLink } from './navigation'
import { Logo } from './Logo'
import styles from './Shell.module.css'

/**
 * Подвал.
 *
 * Разделы честные: ссылки ведут на то, что в системе действительно есть
 * и открыто этой роли, — группы те же, что в боковом меню (`navigationFor`).
 * Юридические реквизиты не придумываем (раздел 26 шаблона страниц) —
 * вместо них сказано, что это прототип и данные демонстрационные.
 */
export function Footer({ groups, service }: { groups: NavGroup[]; service: ServiceLink[] }) {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <span className={styles.footerBrandRow}>
            <Logo size={26} />
            <span className={styles.homeName}>SkillLink</span>
          </span>
          <p className={styles.footerAbout}>
            Система контроля взаимодействия с учебными заведениями: вузы, образовательные
            программы и IT-продукты в одной связке, с историей этапов и объяснимой аналитикой.
          </p>
        </div>

        {groups.map((group) => (
          <div key={group.key} className={styles.footerGroup}>
            <span className={styles.footerTitle}>{group.title}</span>
            {group.items.map((item) => (
              <Link key={item.href} href={item.href} className={styles.footerLink}>
                {item.label}
              </Link>
            ))}
          </div>
        ))}

        <div className={styles.footerGroup}>
          <span className={styles.footerTitle}>Служебное</span>
          {service.map((link) =>
            link.external ? (
              <a key={link.href} className={styles.footerLink} href={link.href} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ) : (
              <Link key={link.href} href={link.href} className={styles.footerLink}>
                {link.label}
              </Link>
            ),
          )}
        </div>
      </div>

      <div className={styles.footerBottom}>
        <div className={styles.footerBottomInner}>
          <span>SkillLink — прототип. Часть данных демонстрационная и помечена в интерфейсе.</span>
          <span>Хакатон ИТ-Школы РТК, 2026</span>
        </div>
      </div>
    </footer>
  )
}
