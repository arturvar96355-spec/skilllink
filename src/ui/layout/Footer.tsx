import Link from 'next/link'
import type { ServiceLink } from './navigation'
import { Logo } from './Logo'
import styles from './Shell.module.css'

/**
 * Подвал — одной спокойной строкой (раздел 27 документа о движении).
 *
 * Разделы системы здесь не повторяются: они в боковом меню, а на узком экране —
 * в меню за кнопкой в шапке. Полный их список в подвале добавлял к каждой
 * странице ещё треть экрана того же самого. Остаются служебные ссылки — их
 * в меню нет — и честная пометка, что это прототип с демонстрационными данными.
 * Юридические реквизиты не придумываем (раздел 26 шаблона страниц).
 */
export function Footer({ service }: { service: ServiceLink[] }) {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span className={styles.footerBrandRow}>
          <Logo size={20} />
          <span className={styles.footerName}>SkillLink</span>
          <span className={styles.footerNote}>
            прототип · часть данных демонстрационная и помечена в интерфейсе · Хакатон ИТ-Школы РТК, 2026
          </span>
        </span>

        <nav className={styles.footerLinks} aria-label="Служебные ссылки">
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
        </nav>
      </div>
    </footer>
  )
}
