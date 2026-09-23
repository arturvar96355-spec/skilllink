'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import {
  CONFIDENCE_LABELS,
  DATA_ORIGIN_LABELS,
  DOCUMENT_TYPE_LABELS,
  PROGRAM_LEVEL_LABELS,
  SKILL_IMPORTANCE_LABELS,
  SKILL_LEVEL_LABELS,
  type CooperationListItemDto,
  type DocumentListItemDto,
  type ProgramDto,
  type SkillDemandDto,
  type SkillGapDto,
  type ProgramSkillDto,
  type RatingFactorDto,
} from '@/shared/contracts'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardsSkeleton,
  CooperationStatusBadge,
  DataTable,
  DocumentStatusBadge,
  EmptyState,
  ErrorState,
  Icon,
  MetricValue,
  MockBadge,
  NO_DATA,
  PageHeader,
  Progress,
  ProgramStatusBadge,
  ROUTES,
  Section,
  StageStatusBadge,
  TableSkeleton,
  Tabs,
  buildQuery,
  cooperationHref,
  documentHref,
  formatDate,
  formatNumber,
  formatPercent,
  formatScore,
  pluralize,
  universityHref,
  useCurrentUser,
  useResource,
  type Column,
  type Resource,
  type TabItem,
} from '@/ui'
import styles from './program.module.css'

/**
 * Карточка образовательной программы (раздел 21 шаблона страниц).
 *
 * Главное на экране — не сам балл, а то, из чего он сложился: рейтинг
 * раскрывается по показателям с весом и вкладом каждого. Балл без объяснения
 * в этой системе считается непригодным (решение 7).
 */

const LIST_PAGE_SIZE = 50

function formatDuration(months: number | null): string {
  if (months === null) return NO_DATA
  return `${formatNumber(months)} ${pluralize(months, ['месяц', 'месяца', 'месяцев'])}`
}

/**
 * Нужна ли вкладка.
 *
 * Есть данные — нужна. Отказ в доступе прячет её совсем: роли, которой раздел
 * закрыт, незачем показывать пустую вкладку с запретом. А вот сбой сервера
 * прятать нельзя — иначе пропавший раздел выглядит как «данных нет»,
 * и его текст ошибки никто не увидит.
 */
function hasTabContent<T>(resource: Resource<T[]>): boolean {
  if (resource.error) {
    return resource.error.code !== 'FORBIDDEN' && resource.error.code !== 'NOT_FOUND'
  }
  return (resource.data?.length ?? 0) > 0
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>{children}</dd>
    </div>
  )
}

export default function ProgramPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const user = useCurrentUser()
  const [tab, setTab] = useState('overview')
  const [isRatingOpen, setRatingOpen] = useState(false)

  const program = useResource<ProgramDto>(`/api/programs/${id}`)
  const data = program.data

  // Связки и документы запрашиваются только после того, как программа нашлась:
  // на 404 незачем слать ещё два запроса про несуществующий объект.
  const cooperations = useResource<CooperationListItemDto[]>(
    data ? `/api/cooperations${buildQuery({ programId: id, pageSize: LIST_PAGE_SIZE })}` : null,
  )
  const documents = useResource<DocumentListItemDto[]>(
    data ? `/api/documents${buildQuery({ programId: id, pageSize: LIST_PAGE_SIZE })}` : null,
  )

  /**
   * Востребованность навыков программы на рынке.
   *
   * Смысл карточки программы не в том, какие навыки в ней записаны, а в том,
   * нужны ли они кому-то. Запрашивается только для навыков этой программы
   * и только когда открыта их вкладка; роли без аналитики эндпоинт закрыт,
   * поэтому для неё столбца просто нет.
   */
  const skillIds = (data?.skills ?? []).map((skill) => skill.skillId)
  const demand = useResource<SkillDemandDto[]>(
    user.permissions.canSeeAnalytics && tab === 'skills' && skillIds.length > 0
      ? `/api/skills/demand${buildQuery({ skillId: skillIds, limit: 200 })}`
      : null,
  )
  const demandBySkill = new Map((demand.data ?? []).map((row) => [row.skillId, row]))

  /**
   * Дефициты программы: чего рынок хочет, а программа не даёт.
   *
   * Обратная сторона спроса и, по сути, ответ на вопрос «зачем этой программе
   * наш продукт». Считает сервер — здесь только показ.
   */
  const gaps = useResource<SkillGapDto[]>(
    user.permissions.canSeeAnalytics && tab === 'gaps'
      ? `/api/skills/gaps${buildQuery({ programId: id, limit: 50 })}`
      : null,
  )
  const gapRows = gaps.data ?? []

  if (program.isLoading) return <CardsSkeleton count={3} />
  // Текст отказа приходит с сервера и показывается как есть: «Программа не найдена».
  if (program.error) return <ErrorState error={program.error} onRetry={program.reload} />
  if (!data) return null

  const skills = data.skills
  const cooperationRows = cooperations.data ?? []
  const documentRows = documents.data ?? []

  // Вкладка показывается только там, где за ней действительно что-то есть
  // (раздел 21 шаблона): пустая вкладка выглядит как сломанный раздел.
  const tabs: TabItem[] = [{ key: 'overview', label: 'Обзор' }]
  if (skills.length > 0) tabs.push({ key: 'skills', label: 'Навыки', count: skills.length })
  // Дефициты считаются по рыночному спросу: роли без аналитики эндпоинт закрыт.
  if (user.permissions.canSeeAnalytics && skills.length > 0) {
    tabs.push({ key: 'gaps', label: 'Дефициты' })
  }
  if (hasTabContent(cooperations)) {
    tabs.push({
      key: 'cooperations',
      label: 'Сотрудничества',
      count: cooperations.meta?.total ?? cooperationRows.length,
    })
  }
  if (hasTabContent(documents)) {
    tabs.push({
      key: 'documents',
      label: 'Документы',
      count: documents.meta?.total ?? documentRows.length,
    })
  }

  // Вкладка могла исчезнуть, пока страница открыта: возвращаемся на обзор.
  const activeTab = tabs.some((item) => item.key === tab) ? tab : 'overview'

  const gapColumns: Column<SkillGapDto>[] = [
    {
      key: 'name',
      title: 'Навык',
      render: (row) => (
        <span className={styles.cellStack}>
          <span className={styles.cellTitle}>{row.name}</span>
          <span className={styles.cellMeta}>{row.category}</span>
        </span>
      ),
    },
    {
      key: 'demand',
      title: 'Спрос рынка',
      width: '150px',
      render: (row) =>
        row.demandNormalized === null ? (
          <span className={styles.empty}>{NO_DATA}</span>
        ) : (
          <span className={styles.plain}>{Math.round(row.demandNormalized * 100)} из 100</span>
        ),
    },
    {
      key: 'coverage',
      title: 'Покрытие программой',
      width: '190px',
      render: (row) => (
        <span className={styles.cellStack}>
          <span className={styles.plain}>{Math.round(row.coverage * 100)}%</span>
          <Progress value={row.coverage * 100} label={`Покрытие навыка ${row.name}`} />
        </span>
      ),
    },
    {
      key: 'gap',
      title: 'Дефицит',
      width: '170px',
      render: (row) => (
        <span className={styles.cellStack}>
          <span className={styles.plain}>
            {Math.round(row.gap * 100)}%
            {row.isCritical && <Badge tone="danger">критический</Badge>}
            {row.isMock && <Badge tone="mock">демо</Badge>}
          </span>
          <Progress
            value={row.gap * 100}
            tone={row.isCritical ? 'danger' : 'default'}
            label={`Дефицит навыка ${row.name}`}
          />
        </span>
      ),
    },
    {
      key: 'explanation',
      title: 'Почему так',
      render: (row) => <span className={styles.cellMeta}>{row.explanation}</span>,
    },
  ]

  const skillColumns: Column<ProgramSkillDto>[] = [
    {
      key: 'name',
      title: 'Навык',
      render: (row) => (
        <span className={styles.cellStack}>
          <span className={styles.cellTitle}>{row.name}</span>
          <span className={styles.cellMeta}>{row.category}</span>
        </span>
      ),
    },
    {
      key: 'level',
      title: 'Уровень',
      render: (row) => <span className={styles.plain}>{SKILL_LEVEL_LABELS[row.level]}</span>,
    },
    {
      key: 'importance',
      title: 'Важность',
      render: (row) => (
        <span className={styles.plain}>{SKILL_IMPORTANCE_LABELS[row.importance]}</span>
      ),
    },
    {
      key: 'source',
      title: 'Источник',
      render: (row) => (
        <span className={styles.plain}>
          {DATA_ORIGIN_LABELS[row.source]}
          {row.source === 'MOCK' && <Badge tone="mock">демо</Badge>}
        </span>
      ),
    },
    {
      key: 'confidence',
      title: 'Доверие',
      render: (row) =>
        row.confidence === null ? (
          <span className={styles.empty}>{NO_DATA}</span>
        ) : (
          <span className={styles.plain}>{CONFIDENCE_LABELS[row.confidence]}</span>
        ),
    },
    {
      key: 'demand',
      title: 'Спрос рынка',
      width: '170px',
      render: (row) => {
        // Пока спрос грузится или запрос не удался — так и пишем. Раньше оба случая
        // выглядели как «Нет данных», и сбой читался как отсутствие спроса на навык.
        if (demand.isLoading) return <span className={styles.empty}>…</span>
        if (demand.error) return <span className={styles.empty}>Не загрузилось</span>
        const market = demandBySkill.get(row.skillId)
        if (!market || market.normalized === null) {
          return <span className={styles.empty}>{NO_DATA}</span>
        }
        const percent = Math.round(market.normalized * 100)
        return (
          <span className={styles.cellStack}>
            <span className={styles.plain}>
              {percent} из 100
              {market.isMock && <Badge tone="mock">демо</Badge>}
            </span>
            <Progress value={percent} label={`Спрос на навык ${row.name}`} />
          </span>
        )
      },
    },
    {
      key: 'comment',
      title: 'Комментарий',
      render: (row) =>
        row.comment === null ? (
          <span className={styles.empty}>—</span>
        ) : (
          <span className={styles.comment}>{row.comment}</span>
        ),
    },
  ]

  const cooperationColumns: Column<CooperationListItemDto>[] = [
    {
      key: 'product',
      title: 'Связка',
      render: (row) => (
        <span className={styles.cellStack}>
          <span className={styles.cellTitle}>{row.productName ?? 'Продукт не выбран'}</span>
          <span className={styles.cellMeta}>{row.universityName}</span>
        </span>
      ),
    },
    {
      key: 'status',
      title: 'Статус',
      render: (row) => <CooperationStatusBadge status={row.status} />,
    },
    {
      key: 'stage',
      title: 'Текущий этап',
      render: (row) =>
        row.currentStage === null ? (
          <span className={styles.empty}>Все этапы закрыты</span>
        ) : (
          <span className={styles.cellStack}>
            <span className={styles.cellTitle}>
              {row.currentStage.stageNumber}. {row.currentStage.title}
            </span>
            <StageStatusBadge status={row.currentStage.status} />
          </span>
        ),
    },
    {
      key: 'progress',
      title: 'Прогресс',
      width: '180px',
      render: (row) => <Progress value={row.progress.percent} withValue label="Прогресс связки" />,
    },
    {
      key: 'updatedAt',
      title: 'Обновлено',
      render: (row) => <span className={styles.plain}>{formatDate(row.updatedAt)}</span>,
    },
  ]

  const documentColumns: Column<DocumentListItemDto>[] = [
    {
      key: 'title',
      title: 'Документ',
      render: (row) => (
        <span className={styles.cellStack}>
          <span className={styles.cellTitle}>{row.title}</span>
          <span className={styles.cellMeta}>{DOCUMENT_TYPE_LABELS[row.type]}</span>
        </span>
      ),
    },
    {
      key: 'version',
      title: 'Версия',
      render: (row) => <span className={styles.plain}>{row.version}</span>,
    },
    {
      key: 'status',
      title: 'Статус',
      render: (row) => <DocumentStatusBadge status={row.status} />,
    },
    {
      key: 'updatedAt',
      title: 'Обновлён',
      render: (row) => <span className={styles.plain}>{formatDate(row.updatedAt)}</span>,
    },
  ]

  const factorColumns: Column<RatingFactorDto>[] = [
    {
      key: 'title',
      title: 'Показатель',
      render: (row) => <span className={styles.cellTitle}>{row.title}</span>,
    },
    {
      key: 'value',
      title: 'Значение',
      align: 'right',
      render: (row) => (
        <span className={row.value === null ? styles.empty : styles.number}>
          {formatNumber(row.value)}
        </span>
      ),
    },
    {
      key: 'weight',
      title: 'Вес',
      align: 'right',
      render: (row) => <span className={styles.number}>{formatPercent(row.weight * 100)}</span>,
    },
    {
      key: 'contribution',
      title: 'Вклад в балл',
      align: 'right',
      render: (row) => (
        <span className={row.contribution === null ? styles.empty : styles.number}>
          {formatScore(row.contribution)}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Программы', href: ROUTES.programs }, { label: data.name }]}
        title={data.name}
        description={data.direction ?? undefined}
        meta={data.isMock ? <MockBadge /> : undefined}
      />

      <Card>
        <div className={styles.header}>
          <Avatar name={data.name} kind="entity" size="xl" />

          <dl className={styles.facts}>
            <Fact label="Вуз">
              <Link className={styles.link} href={universityHref(data.universityId)}>
                {data.universityName}
              </Link>
            </Fact>
            <Fact label="Уровень">{PROGRAM_LEVEL_LABELS[data.level]}</Fact>
            <Fact label="Длительность">{formatDuration(data.durationMonths)}</Fact>
            <Fact label="Статус">
              <ProgramStatusBadge status={data.status} />
            </Fact>
          </dl>

          {data.rating && (
            <div className={styles.rating}>
              <span className={styles.ratingLabel}>Балл рейтинга</span>
              <span className={data.rating.score === null ? styles.scoreEmpty : styles.score}>
                {data.rating.score === null ? NO_DATA : formatScore(data.rating.score)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon={isRatingOpen ? 'chevronDown' : 'chevronRight'}
                iconPosition="right"
                aria-expanded={isRatingOpen}
                onClick={() => setRatingOpen((open) => !open)}
              >
                Из чего сложился
              </Button>
            </div>
          )}
        </div>

        {data.rating && isRatingOpen && (
          <div className={styles.factors}>
            <p className={styles.explanation}>
              <Icon name="info" size={16} />
              {data.rating.explanation}
            </p>
            <DataTable
              rows={data.rating.factors}
              columns={factorColumns}
              getRowKey={(row) => row.key}
              caption="Показатели, из которых сложился балл рейтинга"
            />
            <p className={styles.note}>
              Показатели нормируются внутри всей выборки программ: балл относительный и годится
              только для сравнения программ между собой.
            </p>
          </div>
        )}
      </Card>

      {tabs.length > 1 && <Tabs items={tabs} active={activeTab} onChange={setTab} />}

      {activeTab === 'overview' && (
        <>
          <Section
            title="Показатели набора"
            description="Заявки, обучающиеся и параллельные группы — те самые три показателя, по которым считается рейтинг."
          >
            <div className={styles.metrics}>
              <Card>
                <span className={styles.metricLabel}>Заявки на обучение</span>
                <MetricValue metric={data.metrics.applicationCount} />
              </Card>
              <Card>
                <span className={styles.metricLabel}>Количество обучающихся</span>
                <MetricValue metric={data.metrics.studentCount} />
              </Card>
              <Card>
                <span className={styles.metricLabel}>Параллельных групп</span>
                <MetricValue metric={data.metrics.groupCount} />
              </Card>
            </div>
          </Section>

          <Section title="Сведения">
            <Card>
              <dl className={styles.facts}>
                <Fact label="Направление">
                  {data.direction ?? <span className={styles.empty}>{NO_DATA}</span>}
                </Fact>
                <Fact label="Код">
                  {data.code ?? <span className={styles.empty}>{NO_DATA}</span>}
                </Fact>
                <Fact label="Навыков">{formatNumber(data.skillCount)}</Fact>
                <Fact label="Связок">{formatNumber(data.cooperationCount)}</Fact>
                <Fact label="Создана">{formatDate(data.createdAt)}</Fact>
                <Fact label="Обновлена">{formatDate(data.updatedAt)}</Fact>
                {data.archivedAt !== null && (
                  <Fact label="В архиве с">{formatDate(data.archivedAt)}</Fact>
                )}
              </dl>
              {data.isMock && (
                <p className={styles.mockNote}>
                  <MockBadge />
                </p>
              )}
            </Card>
          </Section>
        </>
      )}

      {activeTab === 'skills' && (
        <Card padding="none">
          <DataTable
            rows={skills}
            columns={skillColumns}
            getRowKey={(row) => row.skillId}
            caption="Навыки программы"
          />
        </Card>
      )}

      {activeTab === 'gaps' && (
        <Card padding="none">
          {gaps.isLoading ? (
            <TableSkeleton rows={4} columns={4} />
          ) : gaps.error ? (
            <ErrorState error={gaps.error} onRetry={gaps.reload} />
          ) : gapRows.length === 0 ? (
            <EmptyState
              icon="skill"
              title="Дефицитов нет"
              description="Навыки программы покрывают то, что востребовано рынком в этом периоде."
            />
          ) : (
            <DataTable
              rows={gapRows}
              columns={gapColumns}
              getRowKey={(row) => row.skillId}
              caption="Дефициты навыков программы"
            />
          )}
        </Card>
      )}

      {activeTab === 'cooperations' &&
        (cooperations.isLoading ? (
          <TableSkeleton rows={4} columns={5} />
        ) : cooperations.error ? (
          <ErrorState error={cooperations.error} onRetry={cooperations.reload} />
        ) : cooperationRows.length === 0 ? (
          <Card muted>
            <EmptyState
              icon="cooperation"
              title="Связок нет"
              description="Программа ещё не участвует ни в одной связке с IT-продуктом."
            />
          </Card>
        ) : (
          <Card padding="none">
            <DataTable
              rows={cooperationRows}
              total={cooperations.meta?.total}
              columns={cooperationColumns}
              getRowKey={(row) => row.id}
              getRowHref={(row) => cooperationHref(row.id)}
              isRefreshing={cooperations.isRefreshing}
              caption="Связки программы"
            />
          </Card>
        ))}

      {activeTab === 'documents' &&
        (documents.isLoading ? (
          <TableSkeleton rows={4} columns={4} />
        ) : documents.error ? (
          <ErrorState error={documents.error} onRetry={documents.reload} />
        ) : documentRows.length === 0 ? (
          <Card muted>
            <EmptyState
              icon="document"
              title="Документов нет"
              description="К программе не привязано ни одного документа."
            />
          </Card>
        ) : (
          <Card padding="none">
            <DataTable
              rows={documentRows}
              total={documents.meta?.total}
              columns={documentColumns}
              getRowKey={(row) => row.id}
              getRowHref={(row) => documentHref(row.id)}
              isRefreshing={documents.isRefreshing}
              caption="Документы программы"
            />
          </Card>
        ))}
    </>
  )
}
