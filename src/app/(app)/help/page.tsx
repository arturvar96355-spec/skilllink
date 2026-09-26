'use client'

import Link from 'next/link'
import { Icon, PageHeader, Section, isUniversityRep, useCurrentUser } from '@/ui'
import { isSectionAllowed } from '@/ui/layout/navigation'
import { termsFor, topicsFor } from './help-content'
import styles from './help.module.css'

/**
 * Справка внутри приложения.
 *
 * ТЗ (нефункциональные требования, п. 5): документация встроена в платформу,
 * а не только лежит в репозитории. Страница открывается из шапки («?») и из
 * подвала на любом экране. Текст — в help-content.ts, вёрстка от него не зависит.
 */
export default function HelpPage() {
  const user = useCurrentUser()
  const rep = isUniversityRep(user)
  const topics = topicsFor(rep)
  const terms = termsFor(rep)

  return (
    <>
      <PageHeader title="Справка" description="Коротко о том, как устроена работа с вузами в SkillLink." />

      <nav className={styles.toc} aria-label="Разделы справки">
        {topics.map((topic) => (
          <a key={topic.id} href={`#${topic.id}`} className={styles.tocItem}>
            {topic.title}
          </a>
        ))}
        <a href="#terms" className={styles.tocItem}>
          Словарь терминов
        </a>
      </nav>

      <div className={styles.topics}>
        {topics.map((topic) => (
          <article key={topic.id} id={topic.id} className={styles.topic}>
            <header className={styles.topicHead}>
              <span className={styles.topicIcon} aria-hidden>
                <Icon name={topic.icon} size={20} />
              </span>
              <h2 className={styles.topicTitle}>{topic.title}</h2>
            </header>
            {topic.image && (
              // Скриншоты — статичные файлы из public/help, оптимизация next/image им не нужна.
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.topicImage} src={topic.image.src} alt={topic.image.alt} loading="lazy" />
            )}
            {topic.paragraphs.map((text) => (
              <p key={text} className={styles.topicText}>
                {text}
              </p>
            ))}
            {/* Ссылку в закрытый роли раздел не даём: там её встретит «Раздел недоступен». */}
            {topic.link && isSectionAllowed(user, topic.link.href) && (
              <Link href={topic.link.href} className={styles.topicLink}>
                {topic.link.label}
                <Icon name="arrowRight" size={16} />
              </Link>
            )}
          </article>
        ))}
      </div>

      <div id="terms" className={styles.terms}>
        <Section title="Словарь терминов">
          <dl className={styles.glossary}>
            {terms.map((item) => (
              <div key={item.term} className={styles.glossaryRow}>
                <dt className={styles.glossaryTerm}>{item.term}</dt>
                <dd className={styles.glossaryDefinition}>{item.definition}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </>
  )
}
