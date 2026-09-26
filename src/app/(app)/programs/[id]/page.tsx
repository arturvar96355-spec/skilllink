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
  PROGRAM_METRIC_LABELS,
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
  Modal,
  mockMarks,
  NO_DATA,
  PageHeader,
  Progress,
  ProgramStatusBadge,
  ROUTES,
  Radar,
  Section,
  StageStatusBadge,
  TableSkeleton,
  Tabs,
  apiPost,
  apiPut,
  buildQuery,
  cooperationHref,
  documentHref,
  formatDate,
  formatNumber,
  formatScore,
  pluralize,
  skillHref,
  universityHref,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
  type Column,
  type Resource,
  type TabItem,
  formatShare,
  formatDemand,
} from '@/ui'
import { AddProgramSkillModal } from '../AddProgramSkillModal'
import { EditProgramModal } from '../EditProgramModal'
import { WhyNoRecommendation } from '../../RuleChecks'
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

/**
 * Оси радара: до четырёх навыков, которые программа покрывает (самые
 * востребованные из них), и остальное — самые востребованные непокрытые.
 * Одни непокрытые схлопнули бы заливку покрытия в точку.
 */
function radarAxes(rows: SkillGapDto[]) {
  const byDemand = [...rows].sort((a, b) => (b.demandNormalized ?? 0) - (a.demandNormalized ?? 0))
  const covered = byDemand.filter((row) => row.coverage > 0).slice(0, 4)
  // Дефициты вне профиля (решение 98) на радар не выносятся: он подчёркивал бы,
  // что магистратуре ИИ «не хватает» Java.
  const rest = byDemand
    .filter((row) => !covered.includes(row) && !row.outOfProfile)
    .slice(0, 8 - covered.length)
  return [...covered, ...rest]
    .sort((a, b) => (b.demandNormalized ?? 0) - (a.demandNormalized ?? 0))
    .map((row) => ({ key: row.skillId, label: row.name, values: [row.demandNormalized, row.coverage] }))
}

export default function ProgramPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const user = useCurrentUser()
  const toast = useToast()
  const [tab, setTab] = useState('overview')
  const [isRatingOpen, setRatingOpen] = useState(false)

  const program = useResource<ProgramDto>(`/api/programs/${id}`)
  // Соседи по реестру — для «Следующей программы» внизу (решение 79).
  const data = program.data

  /**
   * Правка карточки программы и архивация (решение 152, пробел ТЗ РТК): карточки
   * должны изменяться, а не только создаваться. Кнопки — только при `canWrite`;
   * архивация и возврат — с подтверждением.
   */
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const archive = useMutation(async () => {
    const result = await apiPost<ProgramDto>(`/api/programs/${id}/archive`)
    return result.data
  })
  const restore = useMutation(async () => {
    const result = await apiPost<ProgramDto>(`/api/programs/${id}/restore`)
    return result.data
  })

  async function confirmArchive() {
    const result = await archive.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Программа перенесена в архив')
    setIsArchiving(false)
    program.reload()
  }

  async function confirmRestore() {
    const result = await restore.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Программа возвращена из архива')
    setIsRestoring(false)
    program.reload()
  }

  /** Привязка навыков к программе (решение 152, раздел ТЗ «Привязка навыков»). */
  const [isAddSkillOpen, setIsAddSkillOpen] = useState(false)
  const [removingSkillId, setRemovingSkillId] = useState<string | null>(null)
  const removeSkill = useMutation(async (skillId: string) => {
    const skills = (data?.skills ?? [])
      .filter((skill) => skill.skillId !== skillId)
      .map((skill) => ({
        skillId: skill.skillId,
        level: skill.level,
        importance: skill.importance,
        source: skill.source,
        confidence: skill.confidence,
        comment: skill.comment,
      }))
    const result = await apiPut<ProgramDto>(`/api/programs/${id}/skills`, { skills })
    return result.data
  })

  async function onRemoveSkill(skillId: string) {
    setRemovingSkillId(skillId)
    const result = await removeSkill.run(skillId)
    setRemovingSkillId(null)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Навык убран из программы')
    program.reload()
  }

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
  const gapMarks = mockMarks(gapRows)

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
  // Пустая вкладка навыков остаётся видна тому, кто вправе их привязывать:
  // иначе первый навык программе взять было бы неоткуда.
  if (skills.length > 0 || user.permissions.canWrite) {
    tabs.push({ key: 'skills', label: 'Навыки', count: skills.length })
  }
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
          <span className={styles.cellTitle}>
            {row.name}
            {row.outOfProfile && (
              <>
                {' '}
                <Badge
                  tone="neutral"
                  title="Навык и его область не преподаёт ни одна программа той же группы направлений — дефицит может быть не про эту программу"
                >
                  вне профиля
                </Badge>
              </>
            )}
          </span>
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
          <span className={styles.plain}>{formatDemand(row.demandNormalized)}</span>
        ),
    },
    {
      key: 'coverage',
      title: 'Покрытие программой',
      width: '190px',
      render: (row) => (
        <span className={styles.cellStack}>
          <span className={styles.plain}>{formatShare(row.coverage)}</span>
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
            {formatShare(row.gap)}
            {row.isCritical && <Badge tone="danger">критический</Badge>}
            {gapMarks.row(row) && <Badge tone="mock">демо</Badge>}
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
          {/* Навык ведёт к своему разбору в аналитике: спрос, дефицит, программы
              (ТЗ дизайна 26–29.09, п. 1.4 — то, что выглядит объектом, открывается). */}
          <Link className={[styles.cellTitle, styles.cellTitleLink].join(' ')} href={skillHref(row.skillId)}>
            {row.name}
          </Link>
          <span className={styles.cellMeta}>{row.category}</span>
        </span>
      ),
    },
    {
      key: 'level',
      title: 'Уровень',
      width: '120px',
      render: (row) => <span className={styles.plain}>{SKILL_LEVEL_LABELS[row.level]}</span>,
    },
    {
      key: 'importance',
      title: 'Важность',
      width: '120px',
      render: (row) => (
        <span className={styles.plain}>{SKILL_IMPORTANCE_LABELS[row.importance]}</span>
      ),
    },
    {
      key: 'source',
      title: 'Источник',
      width: '150px',
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
      width: '110px',
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
        return (
          <span className={styles.cellStack}>
            <span className={styles.plain}>
              {formatDemand(market.normalized)}
              {market.isMock && <Badge tone="mock">демо</Badge>}
            </span>
            <Progress value={market.normalized * 100} label={`Спрос на навык ${row.name}`} />
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

  if (user.permissions.canWrite) {
    skillColumns.push({
      key: 'actions',
      title: '',
      width: '100px',
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onRemoveSkill(row.skillId)}
          isLoading={removeSkill.isPending && removingSkillId === row.skillId}
          disabled={removeSkill.isPending}
        >
          Убрать
        </Button>
      ),
    })
  }

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
      render: (row) => <span className={styles.number}>{formatShare(row.weight)}</span>,
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
        variant="display"
        breadcrumbs={[{ label: 'Программы', href: ROUTES.programs }, { label: data.name }]}
        title={data.name}
        description={data.direction ?? undefined}
        meta={data.isMock ? <MockBadge /> : undefined}
        actions={
          user.permissions.canWrite ? (
            data.archivedAt === null ? (
              <>
                <Button variant="secondary" onClick={() => setIsEditOpen(true)}>
                  Изменить
                </Button>
                <Button variant="secondary" onClick={() => setIsArchiving(true)}>
                  В архив
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setIsRestoring(true)}>
                Вернуть из архива
              </Button>
            )
          ) : undefined
        }
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
            {/* Три числа на одной поверхности, а не три одинаковые карточки (07, раздел 40). */}
            <div className={styles.metrics}>
              {(['applicationCount', 'studentCount', 'groupCount'] as const).map((key) => (
                <div key={key}>
                  <span className={styles.metricLabel}>{PROGRAM_METRIC_LABELS[key]}</span>
                  <MetricValue metric={data.metrics[key]} />
                </div>
              ))}
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
              {/* Пометка демо-данных — одна на экран, в шапке: вторая здесь была повтором. */}
            </Card>
          </Section>

          {user.permissions.canSeeAnalytics && (
            <Section
              title="Рекомендации по программе"
              description="Какие правила система проверяет по этой программе и что им сейчас мешает сработать."
            >
              <Card>
                <WhyNoRecommendation entity="program" id={data.id} />
              </Card>
            </Section>
          )}
        </>
      )}

      {activeTab === 'skills' && (
        <Section
          title="Навыки программы"
          action={
            user.permissions.canWrite ? (
              <Button variant="secondary" size="sm" icon="plus" onClick={() => setIsAddSkillOpen(true)}>
                Добавить навык
              </Button>
            ) : undefined
          }
        >
          {skills.length === 0 ? (
            <Card muted>
              <EmptyState
                icon="skill"
                title="Навыков нет"
                description="К программе ещё не привязан ни один навык."
              />
            </Card>
          ) : (
            <Card padding="none">
              <DataTable
                rows={skills}
                columns={skillColumns}
                getRowKey={(row) => row.skillId}
                caption="Навыки программы"
              />
            </Card>
          )}
        </Section>
      )}

      {activeTab === 'gaps' && gapMarks.section && (
        <div className={styles.tableNote}>
          <MockBadge title="Спрос рынка в этой таблице — демонстрационный набор, а не подтверждённая статистика." />
        </div>
      )}
      {activeTab === 'gaps' && gapRows.length >= 3 && (
        // Радар: где пунктир спроса выходит за покрытие — там дефицит (решение 79).
        <Card>
          <Section
            title="Спрос против покрытия"
            description="Навыки, которые программа уже даёт, и самые востребованные из тех, что она не даёт. Пунктир — спрос рынка, заливка — покрытие программой."
          >
            <Radar
              label="Спрос рынка и покрытие программой по навыкам"
              axes={radarAxes(gapRows)}
              series={[
                { label: 'Спрос рынка', tone: 'cyan', dashed: true },
                { label: 'Покрытие программой', tone: 'violet' },
              ]}
            />
          </Section>
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

      {isEditOpen && (
        <EditProgramModal
          program={data}
          onClose={(changed) => {
            setIsEditOpen(false)
            if (changed) program.reload()
          }}
        />
      )}
      {isAddSkillOpen && (
        <AddProgramSkillModal
          programId={id}
          existingSkills={skills}
          onClose={(added) => {
            setIsAddSkillOpen(false)
            if (added) program.reload()
          }}
        />
      )}
      {isArchiving && (
        <Modal
          isOpen
          onClose={() => setIsArchiving(false)}
          title="Перенести программу в архив"
          description="Программа пропадёт из активных списков. Связки, документы и история останутся, вернуть можно в любой момент."
          closeOnBackdrop={false}
          footer={
            <>
              <Button variant="ghost" onClick={() => setIsArchiving(false)}>
                Отмена
              </Button>
              <Button variant="danger" onClick={confirmArchive} isLoading={archive.isPending}>
                В архив
              </Button>
            </>
          }
        >
          <p className={styles.note}>Программа: {data.name}.</p>
        </Modal>
      )}
      {isRestoring && (
        <Modal
          isOpen
          onClose={() => setIsRestoring(false)}
          title="Вернуть программу из архива"
          description="Программа снова появится в активных списках."
          closeOnBackdrop={false}
          footer={
            <>
              <Button variant="ghost" onClick={() => setIsRestoring(false)}>
                Отмена
              </Button>
              <Button variant="primary" onClick={confirmRestore} isLoading={restore.isPending}>
                Вернуть из архива
              </Button>
            </>
          }
        >
          <p className={styles.note}>Программа: {data.name}.</p>
        </Modal>
      )}
    </>
  )
}
