'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import type {
  CooperationListItemDto,
  DocumentListItemDto,
  MeetingDto,
  ProgramListItemDto,
  SkillGapDto,
  TimelineEventDto,
  TimelineEventType,
  UniversityDto,
} from '@/shared/contracts'
import {
  MEETING_FORMAT_LABELS,
  PROGRAM_LEVEL_LABELS,
  TIMELINE_EVENT_TYPES,
  USER_ROLE_LABELS,
} from '@/shared/contracts'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CooperationStatusBadge,
  DataTable,
  DeadlineBadge,
  DocumentStatusBadge,
  EmptyState,
  ErrorState,
  HelpHint,
  hasActiveFilters,
  Icon,
  Modal,
  MockBadge,
  mockMarks,
  PageHeader,
  Progress,
  formatStageProgress,
  STAGE_PROGRESS_HINT,
  ProgramStatusBadge,
  ResetFilters,
  Section,
  Select,
  Skeleton,
  TableSkeleton,
  Tabs,
  apiPatch,
  apiPost,
  useMutation,
  useToast,
  Tooltip,
  UniversityStatusBadge,
  buildQuery,
  cooperationHref,
  documentHref,
  formatDate,
  formatDateTime,
  formatNumber,
  formatScore,
  programHref,
  useCurrentUser,
  useResource,
  type Column,
  type TabItem,
  formatShare,
  formatDemand,
  formatPlace,
} from '@/ui'
import { mergeTimelinePage } from './timeline-merge'
import { ChangeResponsibleModal } from '../../ChangeResponsibleModal'
import { EditMeetingModal } from '../../EditMeetingModal'
import { EditUniversityModal } from '../EditUniversityModal'
import { UniversityGraph } from '../UniversityGraph'
import { ContactsCard } from './ContactsCard'
import { MergeWithDuplicate } from './MergeWithDuplicate'
import { UniversityAssistant } from './UniversityAssistant'
import styles from './university.module.css'

type TabKey =
  | 'overview'
  | 'programs'
  | 'cooperations'
  | 'gaps'
  | 'documents'
  | 'meetings'
  | 'history'

/**
 * Лента 360 (решение 182, п. 3): подписи и значки по крупному типу события
 * (`TimelineEventType`), а не по свободной строке `kind` — типов уточнения
 * («stage.status», «university.merge»…) больше, чем стоит заводить под них
 * отдельные значки.
 */
const TIMELINE_TYPE_LABELS: Record<TimelineEventType, string> = {
  cooperation: 'Связки',
  stage: 'Этапы',
  meeting: 'Встречи',
  document: 'Документы',
  application: 'Заявки',
  recommendation: 'Список задач',
  contact: 'Контакты',
  audit: 'Изменения записи',
}

const TIMELINE_TYPE_ICONS: Record<TimelineEventType, 'cooperation' | 'document' | 'calendar' | 'user' | 'recommendation' | 'settings'> = {
  cooperation: 'cooperation',
  stage: 'cooperation',
  meeting: 'calendar',
  document: 'document',
  application: 'user',
  recommendation: 'recommendation',
  contact: 'user',
  audit: 'settings',
}

/**
 * Карточка вуза.
 *
 * Данные вкладок запрашиваются только тогда, когда вкладку открыли: шесть
 * запросов сразу при входе на страницу ради одного просмотренного раздела —
 * это лишняя нагрузка и заметная задержка на медленной сети.
 */
export default function UniversityPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const user = useCurrentUser()
  const [tab, setTab] = useState<TabKey>('overview')

  const university = useResource<UniversityDto>(`/api/universities/${id}`)
  const toast = useToast()

  /**
   * Правка карточки вуза и архивация (решение 152, пробел ТЗ РТК): карточки
   * должны изменяться, а не только создаваться. Обе кнопки — только при
   * `canWrite`; архивация и возврат — с подтверждением, действие обратимо,
   * но затрагивает видимость записи в реестре и запрет менять её дальше.
   */
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const archive = useMutation(async () => {
    const result = await apiPost<UniversityDto>(`/api/universities/${id}/archive`)
    return result.data
  })
  const restore = useMutation(async () => {
    const result = await apiPost<UniversityDto>(`/api/universities/${id}/restore`)
    return result.data
  })

  async function confirmArchive() {
    const result = await archive.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Вуз перенесён в архив')
    setIsArchiving(false)
    university.reload()
  }

  async function confirmRestore() {
    const result = await restore.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Вуз возвращён из архива')
    setIsRestoring(false)
    university.reload()
  }

  /**
   * Ответственный за вуз (ТЗ — роль «Руководитель», решение 146). Кнопка видна
   * только с правом `ASSIGN_RESPONSIBLE` (ADMIN, HEAD) — обычный менеджер её
   * не вызовет, сервер и так откажет `403`, но незачем показывать действие,
   * которое всё равно отклонят.
   */
  const [changingResponsible, setChangingResponsible] = useState(false)
  const removeResponsible = useMutation(async () => {
    const result = await apiPatch<UniversityDto>(`/api/universities/${id}/responsible`, {
      responsibleId: null,
    })
    return result.data
  })

  async function onRemoveResponsible() {
    const result = await removeResponsible.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Ответственный снят')
    university.reload()
  }

  // Соседи по реестру — для «Следующего вуза» внизу (решение 79).
  const programs = useResource<ProgramListItemDto[]>(
    tab === 'programs' ? `/api/programs${buildQuery({ universityId: id, pageSize: 50 })}` : null,
  )
  const cooperations = useResource<CooperationListItemDto[]>(
    tab === 'cooperations' ? `/api/cooperations${buildQuery({ universityId: id, pageSize: 50 })}` : null,
  )
  const documents = useResource<DocumentListItemDto[]>(
    tab === 'documents' ? `/api/documents${buildQuery({ universityId: id, pageSize: 50 })}` : null,
  )
  const meetings = useResource<MeetingDto[]>(
    tab === 'meetings' ? `/api/meetings${buildQuery({ universityId: id, pageSize: 50 })}` : null,
  )
  // Правка встречи (задача «Данные без экрана», пункт 2): встречи вуза раньше только показывались.
  const [editingMeeting, setEditingMeeting] = useState<MeetingDto | null>(null)
  /**
   * Дефициты по вузу: чего рынок требует, а его программы не дают.
   *
   * Тот же расчёт, что в карточке программы, только шире — по всем программам
   * вуза. Роли без аналитики эндпоинт закрыт, поэтому вкладки у неё нет.
   */
  const gaps = useResource<SkillGapDto[]>(
    tab === 'gaps' ? `/api/skills/gaps${buildQuery({ universityId: id, limit: 50 })}` : null,
  )
  const gapMarks = mockMarks(gaps.data ?? [])

  /**
   * Лента 360 (решение 182, п. 3, `GET /api/universities/:id/timeline`) — курсорная
   * пагинация: сервер отдаёт страницу и `nextCursor`, а не общий счётчик. Фронт
   * копит показанные страницы сам (`timelineItems`) — `useResource` меняет данные
   * целиком при смене адреса, а «Показать ещё» здесь должно дописывать, а не
   * подменять список.
   */
  const [timelineType, setTimelineType] = useState<TimelineEventType | ''>('')
  const [timelineCursor, setTimelineCursor] = useState<string | null>(null)
  const [timelineItems, setTimelineItems] = useState<TimelineEventDto[]>([])
  const timeline = useResource<TimelineEventDto[]>(
    tab === 'history'
      ? `/api/universities/${id}/timeline${buildQuery({
          limit: 20,
          cursor: timelineCursor ?? undefined,
          types: timelineType || undefined,
        })}`
      : null,
    { keepPreviousData: true },
  )
  const timelineMeta = timeline.meta as { nextCursor?: string | null; hasMore?: boolean } | null

  useEffect(() => {
    if (!timeline.data) return
    setTimelineItems((previous) => mergeTimelinePage(previous, timeline.data!, timelineCursor))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline.data])

  function onTimelineTypeChange(value: string) {
    setTimelineType(value as TimelineEventType | '')
    setTimelineCursor(null)
  }

  const hasTimelineFilters = hasActiveFilters({ timelineType })
  function resetTimelineFilters() {
    onTimelineTypeChange('')
  }

  if (university.isLoading) {
    return (
      <>
        <Skeleton width="320px" height="30px" />
        <Skeleton height="140px" radius="20px" />
        <Skeleton height="320px" radius="20px" />
      </>
    )
  }

  if (university.error) {
    return <ErrorState error={university.error} onRetry={university.reload} />
  }

  const data = university.data
  if (!data) return null

  const tabs: TabItem[] = [
    { key: 'overview', label: 'Обзор' },
    { key: 'programs', label: 'Программы', count: data.programCount },
    { key: 'cooperations', label: 'Сотрудничества', count: data.cooperationCount },
  ]
  if (user.permissions.canSeeAnalytics) tabs.push({ key: 'gaps', label: 'Дефициты' })
  tabs.push(
    { key: 'documents', label: 'Документы' },
    { key: 'meetings', label: 'Встречи' },
    { key: 'history', label: 'История' },
  )

  const programColumns: Column<ProgramListItemDto>[] = [
    {
      key: 'name',
      title: 'Программа',
      render: (row) => (
        <span className={styles.rowName}>
          <span className={styles.rowTitle}>{row.name}</span>
          <span className={styles.rowMeta}>
            {PROGRAM_LEVEL_LABELS[row.level]}
            {row.direction && ` · ${row.direction}`}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      title: 'Статус',
      width: '150px',
      render: (row) => <ProgramStatusBadge status={row.status} />,
    },
    {
      key: 'skills',
      title: 'Навыки',
      width: '110px',
      align: 'right',
      render: (row) => <span>{formatNumber(row.skillCount)}</span>,
    },
    {
      key: 'cooperations',
      title: 'Связки',
      width: '110px',
      align: 'right',
      render: (row) => <span>{formatNumber(row.cooperationCount)}</span>,
    },
  ]

  const cooperationColumns: Column<CooperationListItemDto>[] = [
    {
      key: 'program',
      title: 'Связка',
      render: (row) => (
        <span className={styles.rowName}>
          <span className={styles.rowTitle}>{row.programName}</span>
          <span className={styles.rowMeta}>{row.productName ?? 'IT-продукт не выбран'}</span>
        </span>
      ),
    },
    {
      key: 'stage',
      title: 'Текущий этап',
      render: (row) =>
        row.currentStage ? (
          <span className={styles.rowName}>
            <span className={styles.rowTitle}>
              {row.currentStage.stageNumber}. {row.currentStage.title}
            </span>
            {(row.currentStage.isOverdue || row.currentStage.isPlanShifted || row.currentStage.isDueSoon) && (
              <span className={styles.rowMeta}>
                <DeadlineBadge
                  isOverdue={row.currentStage.isOverdue}
                  isPlanShifted={row.currentStage.isPlanShifted}
                  isDueSoon={row.currentStage.isDueSoon}
                  daysToDeadline={row.currentStage.daysToDeadline}
                  compact
                />
              </span>
            )}
          </span>
        ) : (
          <span className={styles.rowMeta}>Все этапы закрыты</span>
        ),
    },
    {
      key: 'progress',
      title: 'Прогресс',
      width: '180px',
      render: (row) => (
        <Progress
          value={row.progress.percent}
          withValue
          label="Прогресс связки"
          title={`${formatStageProgress(row.progress.completedStages + row.progress.cancelledStages, row.progress.totalStages)}. ${STAGE_PROGRESS_HINT}`}
        />
      ),
    },
    {
      key: 'status',
      title: 'Статус',
      width: '150px',
      render: (row) => <CooperationStatusBadge status={row.status} />,
    },
  ]

  const gapColumns: Column<SkillGapDto>[] = [
    {
      key: 'name',
      title: 'Навык',
      render: (row) => (
        <span className={styles.rowName}>
          <span className={styles.rowTitle}>{row.name}</span>
          <span className={styles.rowMeta}>{row.category}</span>
        </span>
      ),
    },
    {
      key: 'demand',
      title: 'Спрос рынка',
      width: '140px',
      render: (row) =>
        row.demandNormalized === null ? (
          <span className={styles.rowMeta}>Нет данных</span>
        ) : (
          <span>{formatDemand(row.demandNormalized)}</span>
        ),
    },
    {
      key: 'coverage',
      title: 'Покрытие программами',
      width: '200px',
      render: (row) => (
        <span className={styles.rowName}>
          <span>{formatShare(row.coverage)}</span>
          <Progress value={row.coverage * 100} label={`Покрытие навыка ${row.name}`} />
        </span>
      ),
    },
    {
      key: 'gap',
      title: 'Дефицит',
      width: '180px',
      render: (row) => (
        <span className={styles.rowName}>
          <span className={styles.gapValue}>
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
      render: (row) => <span className={styles.rowMeta}>{row.explanation}</span>,
    },
  ]

  const documentColumns: Column<DocumentListItemDto>[] = [
    {
      key: 'title',
      title: 'Документ',
      render: (row) => (
        <span className={styles.rowName}>
          <span className={styles.rowTitle}>{row.title}</span>
          <span className={styles.rowMeta}>версия {row.version}</span>
        </span>
      ),
    },
    {
      key: 'status',
      title: 'Статус',
      width: '150px',
      render: (row) => <DocumentStatusBadge status={row.status} />,
    },
    {
      key: 'updatedAt',
      title: 'Обновлён',
      width: '140px',
      render: (row) => <span className={styles.rowMeta}>{formatDate(row.updatedAt)}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        variant="display"
        title={data.shortName ?? data.name}
        help={{ topic: 'university-card' }}
        subtitle={data.shortName ? data.name : undefined}
        breadcrumbs={[{ label: 'Вузы', href: '/universities' }, { label: data.shortName ?? data.name }]}
        meta={
          <>
            <UniversityStatusBadge status={data.status} />
            {data.isMock && <MockBadge />}
          </>
        }
        actions={
          user.permissions.canWrite || data.website ? (
            <>
              {user.permissions.canWrite && data.archivedAt === null && (
                <>
                  <Button variant="secondary" onClick={() => setIsEditOpen(true)}>
                    Изменить
                  </Button>
                  <Button variant="secondary" onClick={() => setIsArchiving(true)}>
                    В архив
                  </Button>
                  {/* Решение 210 (В6): слияние было только среди найденных системой пар. */}
                  {user.permissions.isAdmin && (
                    <MergeWithDuplicate
                      university={{ id: data.id, name: data.name, city: data.city }}
                      onMerged={() => university.reload()}
                    />
                  )}
                </>
              )}
              {user.permissions.canWrite && data.archivedAt !== null && (
                <Button variant="secondary" onClick={() => setIsRestoring(true)}>
                  Вернуть из архива
                </Button>
              )}
              {data.website && (
                <Button href={data.website} icon="external" iconPosition="right" variant="secondary">
                  Сайт вуза
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      <div className={styles.head}>
        <Card padding="md" className={styles.headText}>
          <span className={styles.subtitle}>
            <Avatar name={data.shortName ?? data.name} kind="entity" size="lg" />
            <span>
              {formatPlace(data.city, data.region)}
              {data.address && <div className={styles.rowMeta}>{data.address}</div>}
            </span>
          </span>
          {data.description && <p className={styles.description}>{data.description}</p>}
          {/* Число над подписью: подпись в две строки не сдвигает его, числа стоят в ряд. */}
          <div className={styles.facts}>
            <span className={styles.fact}>
              <span className={styles.factValue}>{formatNumber(data.programCount)}</span>
              <span className={styles.factLabel}>Программ в системе</span>
            </span>
            <span className={styles.fact}>
              <span className={styles.factValue}>
                {formatNumber(data.cooperationCount)} / {formatNumber(data.activeCooperationCount)}
              </span>
              <span className={styles.factLabel}>Связок, из них активных</span>
            </span>
            <span className={styles.fact}>
              <span className={styles.factValue}>
                {data.directionCount === null ? 'Нет данных' : formatNumber(data.directionCount)}
              </span>
              <span className={styles.factLabel}>Направлений подготовки</span>
            </span>
            <span className={styles.fact}>
              <span className={styles.factValue}>
                {data.studentCount === null ? 'Нет данных' : formatNumber(data.studentCount)}
              </span>
              <span className={styles.factLabel}>Обучающихся</span>
            </span>
          </div>
        </Card>

        {data.rating && (
          <Card padding="md" className={styles.ratingCard}>
            <span className={[styles.factLabel, styles.labelHelp].join(' ')}>
              Рейтинг вуза
              <HelpHint topic="university-card" section="rating" />
            </span>
            {data.rating.score === null ? (
              <span className={styles.ratingEmpty}>Нет данных</span>
            ) : (
              <span className={styles.ratingValue}>{formatScore(data.rating.score)}</span>
            )}
            <p className={styles.ratingNote}>{data.rating.explanation}</p>
            <p className={styles.ratingNote}>
              Рассчитан по {formatNumber(data.rating.ratedProgramCount)} из{' '}
              {formatNumber(data.rating.programCount)} программ.
            </p>
            {data.rating.topProgram && (
              // Название программы длинное: кнопка переносит его, а не выдавливает страницу вбок.
              <span className={styles.ratingLink}>
              <Button
                href={programHref(data.rating.topProgram.programId)}
                variant="ghost"
                size="sm"
                icon="arrowRight"
                iconPosition="right"
              >
                Сильнейшая: {data.rating.topProgram.name}
              </Button>
              </span>
            )}
          </Card>
        )}
      </div>

      <Tabs items={tabs} active={tab} onChange={(key) => setTab(key as TabKey)} />

      {tab === 'overview' && (
        // Граф связей — первым: суть вуза в SkillLink видна до контактов и реквизитов (решение 79).
        <Section
          title="Связи вуза"
          help={{ topic: 'university-card', section: 'links' }}
          description="Программы вуза и IT-продукты, с которыми они связаны. Цвет провода — статус связки, метка — текущий этап."
        >
          <UniversityGraph
            universityId={data.id}
            universityName={data.name}
            universityCode={data.shortName ?? data.name}
          />
        </Section>
      )}

      {tab === 'overview' && user.permissions.canSeeAnalytics && <UniversityAssistant universityId={data.id} />}

      {tab === 'overview' && (
        <div className={styles.grid}>
          <Card>
            <Section title="Контакты" help={{ topic: 'personal-data' }}>
              <ContactsCard universityId={data.id} contacts={data.contacts} onChanged={() => university.reload()} />
            </Section>
          </Card>

          <Card>
            <Section title="Реквизиты">
              <div className={styles.facts}>
                <span className={styles.fact}>
                  <span className={styles.factLabel}>Сайт</span>
                  <span className={styles.factValue}>
                    {data.website ? (
                      <a
                        className={[styles.factLink, styles.siteLink].join(' ')}
                        href={data.website}
                        target="_blank"
                        rel="noreferrer"
                        title={data.website}
                      >
                        {data.website.replace(/^https?:\/\//, '')}
                      </a>
                    ) : (
                      'Нет данных'
                    )}
                  </span>
                </span>
                <span className={styles.fact}>
                  <span className={styles.factLabel}>Заведён</span>
                  <span className={styles.factValue}>{formatDate(data.createdAt)}</span>
                </span>
                <span className={styles.fact}>
                  <span className={styles.factLabel}>Обновлён</span>
                  <span className={styles.factValue}>{formatDate(data.updatedAt)}</span>
                </span>
                {data.archivedAt && (
                  <span className={styles.fact}>
                    <span className={styles.factLabel}>В архиве с</span>
                    <span className={styles.factValue}>{formatDate(data.archivedAt)}</span>
                  </span>
                )}
              </div>

              <div className={styles.responsibleRow}>
                <span className={[styles.factLabel, styles.labelHelp].join(' ')}>
                  Ответственный
                  <HelpHint topic="university-card" section="responsible" />
                </span>
                <span className={styles.factValue}>
                  {data.responsible ? data.responsible.fullName : 'Не назначен'}
                </span>
                {user.permissions.canAssignResponsible && (
                  <span className={styles.responsibleActions}>
                    <Button size="sm" variant="secondary" onClick={() => setChangingResponsible(true)}>
                      {data.responsible ? 'Сменить ответственного' : 'Назначить ответственного'}
                    </Button>
                    {data.responsible && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onRemoveResponsible}
                        isLoading={removeResponsible.isPending}
                      >
                        Снять ответственного
                      </Button>
                    )}
                  </span>
                )}
              </div>
            </Section>
          </Card>
        </div>
      )}

      {tab === 'programs' && (
        <Card padding="none">
          {programs.isLoading ? (
            <TableSkeleton rows={4} columns={4} />
          ) : programs.error ? (
            <ErrorState error={programs.error} onRetry={programs.reload} />
          ) : (programs.data ?? []).length === 0 ? (
            <EmptyState icon="program" title="Программ нет" description="У вуза не заведено ни одной образовательной программы." />
          ) : (
            <DataTable
              rows={programs.data ?? []}
              total={programs.meta?.total}
              columns={programColumns}
              getRowKey={(row) => row.id}
              getRowHref={(row) => programHref(row.id)}
              caption="Программы вуза"
            />
          )}
        </Card>
      )}

      {tab === 'cooperations' && (
        <Card padding="none">
          {cooperations.isLoading ? (
            <TableSkeleton rows={4} columns={4} />
          ) : cooperations.error ? (
            <ErrorState error={cooperations.error} onRetry={cooperations.reload} />
          ) : (cooperations.data ?? []).length === 0 ? (
            <EmptyState icon="cooperation" title="Связок нет" description="С этим вузом ещё не заведено ни одной связки." />
          ) : (
            <DataTable
              rows={cooperations.data ?? []}
              total={cooperations.meta?.total}
              columns={cooperationColumns}
              getRowKey={(row) => row.id}
              getRowHref={(row) => cooperationHref(row.id)}
              caption="Связки вуза"
            />
          )}
        </Card>
      )}

      {tab === 'gaps' && (
        <div className={styles.tableNote}>
          {gapMarks.section && (
            <MockBadge title="Спрос рынка в этой таблице — демонстрационный набор, а не подтверждённая статистика." />
          )}
          <HelpHint topic="programs" section="demand" />
        </div>
      )}
      {tab === 'gaps' && (
        <Card padding="none">
          {gaps.isLoading ? (
            <TableSkeleton rows={5} columns={4} />
          ) : gaps.error ? (
            <ErrorState error={gaps.error} onRetry={gaps.reload} />
          ) : (gaps.data ?? []).length === 0 ? (
            <EmptyState
              icon="skill"
              title="Дефицитов нет"
              description="Программы вуза покрывают то, что востребовано рынком в этом периоде."
            />
          ) : (
            <DataTable
              rows={gaps.data ?? []}
              columns={gapColumns}
              getRowKey={(row) => row.skillId}
              caption="Дефициты навыков вуза"
            />
          )}
        </Card>
      )}

      {tab === 'documents' && (
        <Card padding="none">
          {documents.isLoading ? (
            <TableSkeleton rows={4} columns={3} />
          ) : documents.error ? (
            <ErrorState error={documents.error} onRetry={documents.reload} />
          ) : (documents.data ?? []).length === 0 ? (
            <EmptyState icon="document" title="Документов нет" description="По этому вузу документы ещё не заводились." />
          ) : (
            <DataTable
              rows={documents.data ?? []}
              total={documents.meta?.total}
              columns={documentColumns}
              getRowKey={(row) => row.id}
              getRowHref={(row) => documentHref(row.id)}
              caption="Документы вуза"
            />
          )}
        </Card>
      )}

      {tab === 'meetings' && (
        <Card>
          {meetings.isLoading ? (
            <TableSkeleton rows={3} columns={3} />
          ) : meetings.error ? (
            <ErrorState error={meetings.error} onRetry={meetings.reload} />
          ) : (meetings.data ?? []).length === 0 ? (
            <EmptyState icon="calendar" title="Встреч нет" description="Встречи с этим вузом не зафиксированы." />
          ) : (
            <div className={styles.events}>
              {(meetings.data ?? []).map((meeting) => (
                <span key={meeting.id} className={styles.event}>
                  <span className={styles.eventIcon}>
                    <Icon name="calendar" size={16} />
                  </span>
                  <span className={styles.eventText}>
                    <span className={styles.eventTitle}>{meeting.topic}</span>
                    {meeting.result && <span className={styles.eventDetails}>{meeting.result}</span>}
                    {meeting.nextAction && (
                      <span className={styles.eventDetails}>
                        Следующий шаг: {meeting.nextAction}
                        {meeting.nextActionDueAt && ` до ${formatDate(meeting.nextActionDueAt)}`}
                      </span>
                    )}
                    <span className={styles.eventMeta}>
                      {formatDate(meeting.date)} · {MEETING_FORMAT_LABELS[meeting.format]} ·{' '}
                      {meeting.responsible.fullName}
                    </span>
                    {user.permissions.canWrite && (
                      <Button variant="ghost" size="sm" onClick={() => setEditingMeeting(meeting)}>
                        Изменить
                      </Button>
                    )}
                  </span>
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'history' && (
        <Card>
          <div className={styles.timelineFilterRow}>
            <div className={styles.timelineFilter}>
              <Select
                label="Тип события"
                hideLabel
                placeholder="Все типы"
                value={timelineType}
                onValueChange={onTimelineTypeChange}
                options={TIMELINE_EVENT_TYPES.map((type) => ({ value: type, label: TIMELINE_TYPE_LABELS[type] }))}
              />
            </div>
            {hasTimelineFilters && <ResetFilters active onReset={resetTimelineFilters} />}
            <HelpHint topic="university-card" section="history" />
          </div>
          {timelineItems.length === 0 && timeline.isLoading ? (
            <TableSkeleton rows={5} columns={2} />
          ) : timelineItems.length === 0 && timeline.error ? (
            <ErrorState error={timeline.error} onRetry={timeline.reload} />
          ) : timelineItems.length === 0 ? (
            <EmptyState
              icon="clock"
              title="Событий нет"
              description={
                timelineType
                  ? `Событий типа «${TIMELINE_TYPE_LABELS[timelineType]}» по вузу не найдено.`
                  : 'По вузу ещё ничего не происходило.'
              }
              action={hasTimelineFilters ? <ResetFilters active onReset={resetTimelineFilters} /> : undefined}
            />
          ) : (
            <>
              <div className={styles.events}>
                {timelineItems.map((event) => (
                  <span key={event.id} className={styles.event}>
                    <span className={styles.eventIcon}>
                      <Icon name={TIMELINE_TYPE_ICONS[event.type]} size={16} />
                    </span>
                    <span className={styles.eventText}>
                      <span className={styles.eventTitle}>
                        {event.href ? <Link href={event.href}>{event.title}</Link> : event.title}
                      </span>
                      {event.details && <span className={styles.eventDetails}>{event.details}</span>}
                      <span className={styles.eventMeta}>
                        {formatDateTime(event.occurredAt)}
                        {event.author && ` · ${event.author.fullName} (${USER_ROLE_LABELS[event.author.role]})`}
                        {event.programName && ` · ${event.programName}`}
                      </span>
                    </span>
                  </span>
                ))}
              </div>
              {timeline.error && <p className={styles.rowMeta}>{timeline.error.message}</p>}
              {timelineMeta?.hasMore ? (
                <div className={styles.center}>
                  <Button
                    variant="secondary"
                    icon="chevronDown"
                    onClick={() => setTimelineCursor(timelineMeta.nextCursor ?? null)}
                    isLoading={timeline.isRefreshing}
                    disabled={timeline.isRefreshing}
                  >
                    Показать ещё
                  </Button>
                </div>
              ) : (
                <p className={styles.rowMeta}>
                  Показаны все события{timelineType ? ` типа «${TIMELINE_TYPE_LABELS[timelineType]}»` : ''}.
                </p>
              )}
            </>
          )}
        </Card>
      )}

      {!user.permissions.canSeeAnalytics && data.rating === null && (
        <p className={styles.rowMeta}>
          <Tooltip text="Рейтинг доступен ролям с правом на аналитику.">
            <span>Рейтинг вуза скрыт для вашей роли.</span>
          </Tooltip>
        </p>
      )}
      {isEditOpen && (
        <EditUniversityModal
          university={data}
          onClose={(changed) => {
            setIsEditOpen(false)
            if (changed) university.reload()
          }}
        />
      )}
      {isArchiving && (
        <Modal
          isOpen
          onClose={() => setIsArchiving(false)}
          title="Перенести вуз в архив"
          help={{ topic: 'university-card', section: 'archive' }}
          description="Вуз пропадёт из активных списков и его нельзя будет изменять, пока не вернёте из архива. Программы, связки и история сотрудничества останутся."
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
          <p className={styles.rowMeta}>Вуз: {data.shortName ?? data.name}.</p>
        </Modal>
      )}
      {isRestoring && (
        <Modal
          isOpen
          onClose={() => setIsRestoring(false)}
          title="Вернуть вуз из архива"
          help={{ topic: 'university-card', section: 'archive' }}
          description="Вуз снова появится в активных списках, и его можно будет изменять."
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
          <p className={styles.rowMeta}>Вуз: {data.shortName ?? data.name}.</p>
        </Modal>
      )}
      {changingResponsible && (
        <ChangeResponsibleModal
          title={data.responsible ? 'Сменить ответственного за вуз' : 'Назначить ответственного за вуз'}
          help={{ topic: 'university-card', section: 'responsible' }}
          description="Ответственный за вуз — сотрудник, который ведёт работу с ним в целом, отдельно от ответственных по конкретным связкам."
          endpoint={`/api/universities/${id}/responsible`}
          consequence="Новый ответственный увидит назначение в уведомлениях и получит сообщение в подключённый мессенджер, смена попадёт в журнал действий. Ответственные по связкам вуза не меняются."
          currentResponsibleId={data.responsible?.id ?? null}
          currentResponsibleName={data.responsible?.fullName ?? null}
          allowNone
          onClose={(changed) => {
            setChangingResponsible(false)
            if (changed) university.reload()
          }}
        />
      )}
      {editingMeeting && (
        <EditMeetingModal
          key={editingMeeting.id}
          meeting={editingMeeting}
          onClose={(updated) => {
            setEditingMeeting(null)
            if (updated) meetings.reload()
          }}
        />
      )}
    </>
  )
}
