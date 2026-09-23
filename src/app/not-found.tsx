import { Button, Logo } from '@/ui'
import styles from './not-found.module.css'

/**
 * Несуществующий адрес.
 *
 * Без этой страницы Next показывал свою: белую, по-английски — «This page could
 * not be found», — посреди тёмного русского интерфейса. На показе такой адрес
 * набирается одной опечаткой.
 */
export default function NotFound() {
  return (
    <main className={styles.screen}>
      <div className={styles.panel}>
        <span className={styles.brand}>
          <Logo size={24} />
          SkillLink
        </span>
        <span className={styles.code}>404</span>
        <h1 className={styles.title}>Такой страницы нет</h1>
        <p className={styles.text}>
          Адрес мог устареть или в нём опечатка. Все разделы системы — в меню на главной.
        </p>
        <Button href="/">На главную</Button>
      </div>
    </main>
  )
}
