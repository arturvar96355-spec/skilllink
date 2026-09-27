import type { Metadata } from 'next'
import Link from 'next/link'
import { HELP_SECTIONS } from '@/shared/help'
import { Button } from '@/ui/primitives/Button'
import { Logo } from '@/ui/layout/Logo'
import { ThemeToggle } from '@/ui/layout/ThemeToggle'
import { OPEN_SOURCE_REPO_URL, ROUTES } from '@/ui/lib/links'
import { DocsReader } from './DocsReader'
import styles from './docs.module.css'

export const metadata: Metadata = {
  title: 'Документация — SkillLink',
  description:
    'Как пользоваться SkillLink — системой сотрудничества ИТ-Школы с вузами: каждый экран и инструмент, роли и права, шаги и частые вопросы.',
}

/** Руководство файлом — тот же текст, собранный из реестра (`npm run docs:user-guide`). */
const USER_GUIDE_URL = `${OPEN_SOURCE_REPO_URL}/blob/main/docs/USER_GUIDE.md`

/**
 * Публичная документация — открыта без входа (решение 214, `src/middleware.ts`,
 * `OPEN_PATHS`). Только текст из реестра `shared/help`: ни одного запроса к API
 * и к базе, данных системы на странице нет — это проверяет тест.
 *
 * Страница не собирается заранее (статически): корневой макет читает заголовки
 * запроса ради nonce политики безопасности (решение 112), и так динамичны все
 * страницы. Здесь это дёшево: текст — константа модуля, запросов нет.
 */
export default function DocsPage() {
  return (
    <div className={styles.screen}>
      <header className={styles.topBar}>
        <Link href="/docs" className={styles.brand} aria-label="Документация SkillLink — в начало">
          <Logo size={24} />
          <span className={styles.brandName}>SkillLink</span>
          <span className={styles.brandSection}>Документация</span>
        </Link>
        <span className={styles.topSpacer} />
        <ThemeToggle />
        <Button href={ROUTES.login} variant="secondary" size="sm" className={styles.topLogin}>
          Войти в систему
        </Button>
        <Button href={ROUTES.dashboard} variant="primary" size="sm" className={styles.topStand}>
          Открыть стенд
        </Button>
      </header>

      <main className={styles.main}>
        <DocsReader
          variant="public"
          intro={
            <header className={styles.intro}>
              <h1 className={styles.introTitle}>Документация SkillLink</h1>
              <p className={styles.introLead}>
                SkillLink — система, в которой ИТ-Школа ведёт сотрудничество с вузами: вуз, его программа
                и IT-продукт образуют связку, а связка проходит четырнадцать этапов — от первого контакта
                до занятий. Здесь описан каждый экран и инструмент: что это, кто может, по шагам и частые вопросы.
              </p>
              <p className={styles.introText}>
                Мало времени — начните с{' '}
                <a href="#expert-start" className={styles.introLink}>
                  маршрута эксперта на пять минут
                </a>{' '}
                и таблицы{' '}
                <a href="#roles" className={styles.introLink}>
                  «Роли и права»
                </a>
                . Всего разделов: {HELP_SECTIONS.length}; тот же текст файлом —{' '}
                <a href={USER_GUIDE_URL} className={styles.introLink} target="_blank" rel="noopener noreferrer">
                  руководство пользователя
                </a>
                .
              </p>
            </header>
          }
        />
      </main>

      <footer className={styles.footer}>
        <span>SkillLink — прототип для хакатона ИТ-Школы РТК; данные на стенде демонстрационные и помечены.</span>
        <span className={styles.footerLinks}>
          <Link href={ROUTES.privacy}>Персональные данные</Link>
          <a href={OPEN_SOURCE_REPO_URL} target="_blank" rel="noopener noreferrer">
            Открытый код
          </a>
        </span>
      </footer>
    </div>
  )
}
