import Link from 'next/link'
import { ROUTES } from '../lib/links'
import { Logo } from './Logo'
import styles from './Shell.module.css'

/**
 * Подвал.
 *
 * Разделы честные: ссылки ведут на то, что в системе действительно есть.
 * Юридические реквизиты не придумываем (раздел 26 шаблона страниц) —
 * вместо них сказано, что это прототип и данные демонстрационные.
 */
export function Footer() {
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

        <div className={styles.footerGroup}>
          <span className={styles.footerTitle}>Работа</span>
          <Link href={ROUTES.universities} className={styles.footerLink}>
            Университеты
          </Link>
          <Link href={ROUTES.programs} className={styles.footerLink}>
            Программы
          </Link>
          <Link href={ROUTES.cooperations} className={styles.footerLink}>
            Сотрудничество
          </Link>
          <Link href={ROUTES.recommendations} className={styles.footerLink}>
            Рекомендации
          </Link>
        </div>

        <div className={styles.footerGroup}>
          <span className={styles.footerTitle}>Инструменты</span>
          <Link href={ROUTES.analytics} className={styles.footerLink}>
            Аналитика
          </Link>
          <Link href={ROUTES.documents} className={styles.footerLink}>
            Документы
          </Link>
          <Link href={ROUTES.products} className={styles.footerLink}>
            IT-продукты
          </Link>
          <Link href={ROUTES.settings} className={styles.footerLink}>
            Настройки
          </Link>
        </div>

        <div className={styles.footerGroup}>
          <span className={styles.footerTitle}>Служебное</span>
          <a className={styles.footerLink} href="/api/openapi.json" target="_blank" rel="noreferrer">
            Контракт API
          </a>
          <a className={styles.footerLink} href="/api/health" target="_blank" rel="noreferrer">
            Состояние системы
          </a>
          <Link href={`${ROUTES.settings}#integrations`} className={styles.footerLink}>
            Источники данных
          </Link>
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
