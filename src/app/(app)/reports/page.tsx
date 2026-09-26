import { Button, Card, Icon, PageHeader, ROUTES, type IconName } from '@/ui'
import styles from './reports-index.module.css'

interface ReportCard {
  href: string
  icon: IconName
  title: string
  description: string
}

const REPORT_CARDS: ReportCard[] = [
  {
    href: ROUTES.managerReport,
    icon: 'document',
    title: 'Отчёт руководителю',
    description:
      'Ключевые показатели, проблемные этапы, приоритетные действия и лучшие программы — лист A4 для печати и отправки.',
  },
  {
    href: ROUTES.tzReport,
    icon: 'report',
    title: 'Отчёт по ТЗ',
    description: 'Вуз, ИТ-направление, ИТ-продукт, статус работы и ответственный — колонки дословно из ТЗ.',
  },
  {
    href: ROUTES.catalogReport,
    icon: 'product',
    title: 'Каталог по ТЗ',
    description: 'Договор, лицензия, статус передачи ПО, менеджер и ответственные от вуза — по каждой связке.',
  },
]

/**
 * Раздел «Отчёты» (решение 150).
 *
 * Раньше единственный отчёт (руководителю, решение 97) открывался только
 * ссылкой с главной и с аналитики — своего места в меню и общей страницы
 * не было. Отчёт и каталог по ТЗ (решение 145, API) добавили сюда же, а не
 * отдельным пунктом меню на каждый: одно место, где собраны все готовые
 * отчёты системы.
 */
export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Отчёты"
        breadcrumbs={[{ label: 'Отчёты' }]}
        description="Готовые отчёты системы — превью на экране, файл в CSV, XLSX или JSON, печать в PDF."
      />

      <div className={styles.grid}>
        {REPORT_CARDS.map((report) => (
          <Card key={report.href} className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.iconBadge}>
                <Icon name={report.icon} size={20} />
              </span>
              <span className={styles.cardTitle}>{report.title}</span>
            </div>
            <p className={styles.cardText}>{report.description}</p>
            <Button href={report.href} variant="secondary" icon="arrowRight" iconPosition="right">
              Открыть
            </Button>
          </Card>
        ))}
      </div>
    </>
  )
}
