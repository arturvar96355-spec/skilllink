import {
  HELP_ROLE_COLUMNS,
  HELP_SECTION_GROUPS,
  HELP_TERMS,
  HELP_TERMS_ANCHOR,
  type HelpRightsRow,
  type HelpSection,
} from '@/shared/help'
import { Icon } from '@/ui/primitives/Icon'
import { DocsAnchor } from './DocsAnchor'
import { DocsWhere } from './DocsWhere'
import styles from './docs.module.css'

/**
 * Текст документации — серверная разметка из реестра `shared/help` (решение 214).
 *
 * Вся документация приходит готовым HTML: читается без JavaScript, находится
 * поиском браузера и не тянет реестр в клиентский код. Поиск по странице
 * (`DocsNav`) читает текст из этой же разметки по `data-doc-*`.
 *
 * Раздел — «справочная карточка» без рамки: заголовок, два предложения
 * «что это и как», затем строки с подписью слева — «Что это», «Зачем»,
 * «Кто может», «Как пользоваться», «Частые вопросы», «Где найти». Подпись
 * слева — чтобы глаз шёл по одной колонке и сразу находил нужную строку.
 */
export function DocsArticle() {
  return (
    <>
      {HELP_SECTION_GROUPS.map((group) => (
        <section key={group.id} className={styles.group} data-doc-group aria-labelledby={`group-${group.id}`}>
          <h2 id={`group-${group.id}`} className={styles.groupTitle}>
            {group.title}
          </h2>
          {group.sections.map((section) => (
            <DocsSection key={section.id} section={section} group={group.title} />
          ))}
        </section>
      ))}

      <section className={styles.group} data-doc-group aria-labelledby="group-terms">
        <h2 id="group-terms" className={styles.groupTitle}>
          Справочник
        </h2>
        <article
          id={HELP_TERMS_ANCHOR}
          className={styles.section}
          data-doc-section
          data-doc-group-title="Справочник"
          aria-labelledby={`${HELP_TERMS_ANCHOR}-title`}
        >
          <header className={styles.sectionHead}>
            <h3 id={`${HELP_TERMS_ANCHOR}-title`} className={styles.sectionTitle} data-doc-title>
              Словарь терминов
            </h3>
            <DocsAnchor id={HELP_TERMS_ANCHOR} title="Словарь терминов" />
          </header>
          <dl className={styles.glossary}>
            {HELP_TERMS.map((item) => (
              <div key={item.term} className={styles.glossaryRow}>
                <dt className={styles.glossaryTerm}>{item.term}</dt>
                <dd className={styles.glossaryDefinition}>{item.definition}</dd>
              </div>
            ))}
          </dl>
        </article>
      </section>
    </>
  )
}

function DocsSection({ section, group }: { section: HelpSection; group: string }) {
  const titleId = `${section.id}-title`
  return (
    <article
      id={section.id}
      className={styles.section}
      data-doc-section
      data-doc-group-title={group}
      aria-labelledby={titleId}
    >
      <header className={styles.sectionHead}>
        <h3 id={titleId} className={styles.sectionTitle} data-doc-title>
          {section.title}
        </h3>
        <DocsAnchor id={section.id} title={section.title} />
      </header>

      <p className={styles.lead}>{section.short}</p>
      <p className={styles.leadHow}>{section.how}</p>

      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Что это</dt>
          <dd className={styles.factBody}>
            {section.about.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Зачем</dt>
          <dd className={styles.factBody}>
            <p>{section.why}</p>
          </dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Кто может</dt>
          <dd className={styles.factBody}>
            <p>{section.who}</p>
          </dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Как пользоваться</dt>
          <dd className={styles.factBody}>
            <ol className={styles.steps}>
              {section.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </dd>
        </div>
      </dl>

      {section.rights && <RightsTable rows={section.rights} />}

      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Частые вопросы</dt>
          <dd className={styles.factBody}>
            <div className={styles.faq}>
              {section.faq.map((item) => (
                <details key={item.q} className={styles.faqItem}>
                  <summary className={styles.faqQuestion}>{item.q}</summary>
                  <p className={styles.faqAnswer}>{item.a}</p>
                </details>
              ))}
            </div>
          </dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Где найти</dt>
          <dd className={styles.factBody}>
            <DocsWhere href={section.where.href} label={section.where.label} />
          </dd>
        </div>
      </dl>
    </article>
  )
}

/** «да» — значком с подписью для программ чтения с экрана, «—» — тихим прочерком, остальное — словами. */
function RightsCell({ value }: { value: string }) {
  if (value === 'да') {
    return (
      <span className={styles.rightYes} data-doc-skip>
        <Icon name="check" size={16} />
        <span className="visually-hidden">да</span>
      </span>
    )
  }
  if (value === '—') {
    return (
      <span className={styles.rightNo} data-doc-skip>
        <span aria-hidden="true">—</span>
        <span className="visually-hidden">нет</span>
      </span>
    )
  }
  return <span className={styles.rightPartial}>{value}</span>
}

function RightsTable({ rows }: { rows: readonly HelpRightsRow[] }) {
  return (
    <div className={styles.rightsWrap} role="region" aria-label="Таблица прав по ролям" tabIndex={0}>
      <table className={styles.rights}>
        <thead>
          <tr>
            <th scope="col" className={styles.rightsAction}>
              Что можно
            </th>
            {HELP_ROLE_COLUMNS.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" className={styles.rightsAction}>
                {row.label}
              </th>
              {HELP_ROLE_COLUMNS.map((column) => (
                <td key={column.key}>
                  <RightsCell value={row.cells[column.key]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
