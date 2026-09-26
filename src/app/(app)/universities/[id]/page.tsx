'use client'

import { useParams } from 'next/navigation'
import { useState } from 'react'
import type {
  ContactDto,
  CooperationListItemDto,
  DocumentListItemDto,
  MeetingDto,
  ProgramListItemDto,
  SkillGapDto,
  UniversityDto,
  UniversityEventDto,
} from '@/shared/contracts'
import {
  MEETING_FORMAT_LABELS,
  PROGRAM_LEVEL_LABELS,
  UNIVERSITY_EVENTS_MAX_LIMIT,
  USER_ROLE_LABELS,
} from '@/shared/contracts'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CooperationStatusBadge,
  DataTable,
  DocumentStatusBadge,
  EmptyState,
  ErrorState,
  Icon,
  Modal,
  MockBadge,
  mockMarks,
  PageHeader,
  Progress,
  ProgramStatusBadge,
  Section,
  Skeleton,
  TableSkeleton,
  Tabs,
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
import { UniversityGraph } from '../UniversityGraph'
import styles from './university.module.css'

type TabKey =
  | 'overview'
  | 'programs'
  | 'cooperations'
  | 'gaps'
  | 'documents'
  | 'meetings'
  | 'history'

const EVENT_ICONS: Record<UniversityEventDto['kind'], 'cooperation' | 'document' | 'calendar' | 'user'> = {
  'cooperation.created': 'cooperation',
  'stage.status': 'cooperation',
  'document.status': 'document',
  meeting: 'calendar',
  application: 'user',
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
   * Обезличивание контакта по запросу субъекта ПД (docs/PRIVACY.md) — только
   * администратор, с подтверждением: действие необратимо.
   */
  const [anonymizing, setAnonymizing] = useState<ContactDto | null>(null)
  const anonymize = useMutation(async (contactId: string) => {
    const result = await apiPost<ContactDto>(
      `/api/universities/${id}/contacts/${contactId}/anonymize`,
    )
    return result.data
  })

  async function confirmAnonymize() {
    if (!anonymizing) return
    const result = await anonymize.run(anonymizing.id)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Персональные данные контакта удалены')
    setAnonymizing(null)
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

  const [eventsLimit, setEventsLimit] = useState(20)
  const events = useResource<UniversityEventDto[]>(
    tab === 'history' ? `/api/universities/${id}/events${buildQuery({ limit: eventsLimit })}` : null,
    { keepPreviousData: true },
  )

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
            {row.currentStage.isOverdue && (
              <span className={styles.rowMeta}>
                <Badge tone="danger">Просрочен</Badge>
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
        <Progress value={row.progress.percent} withValue label="Прогресс связки" />
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
        subtitle={data.shortName ? data.name : undefined}
        breadcrumbs={[{ label: 'Университеты', href: '/universities' }, { label: data.shortName ?? data.name }]}
        meta={
          <>
            <UniversityStatusBadge status={data.status} />
            {data.isMock && <MockBadge />}
          </>
        }
        actions={
          data.website ? (
            <Button href={data.website} icon="external" iconPosition="right" variant="secondary">
              Сайт вуза
            </Button>
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
            <span className={styles.factLabel}>Рейтинг вуза</span>
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
          description="Программы вуза и IT-продукты, с которыми они связаны. Цвет провода — статус связки, метка — текущий этап."
        >
          <UniversityGraph
            universityId={data.id}
            universityName={data.name}
            universityCode={data.shortName ?? data.name}
          />
        </Section>
      )}

      {tab === 'overview' && (
        <div className={styles.grid}>
          <Card>
            <Section title="Контакты">
              {data.contacts.length === 0 ? (
                <p className={styles.rowMeta}>Контактные лица не заведены.</p>
              ) : (
                <div className={styles.contacts}>
                  {data.contacts.map((contact) => (
                    <span key={contact.id} className={styles.contact}>
                      <Avatar name={contact.fullName} size="sm" />
                      <span className={styles.contactText}>
                        <span className={styles.contactName}>
                          {contact.fullName}
                          {/* Текстовая метка, не бирка (решение 140, п. 9): плашка выглядела
                              как кнопка, хотя нажать её было нельзя. */}
                          {contact.isPrimary && <span className={styles.primaryTag}> · основной</span>}
                        </span>
                        <span className={styles.contactMeta}>{contact.position ?? 'должность не указана'}</span>
                        <span className={styles.contactLinks}>
                          {contact.email && (
                            <a className={styles.factLink} href={`mailto:${contact.email}`}>
                              {contact.email}
                            </a>
                          )}
                          {contact.phone && <span className={styles.rowMeta}>{contact.phone}</span>}
                        </span>
                        {user.permissions.isAdmin && !contact.isAnonymized && (
                          <span>
                            <Button variant="ghost" size="sm" onClick={() => setAnonymizing(contact)}>
                              Удалить персональные данные
                            </Button>
                          </span>
                        )}
                      </span>
                    </span>
                  ))}
                </div>
              )}
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

      {tab === 'gaps' && gapMarks.section && (
        <div className={styles.tableNote}>
          <MockBadge title="Спрос рынка в этой таблице — демонстрационный набор, а не подтверждённая статистика." />
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
                  </span>
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'history' && (
        <Card>
          {events.isLoading ? (
            <TableSkeleton rows={5} columns={2} />
          ) : events.error ? (
            <ErrorState error={events.error} onRetry={events.reload} />
          ) : (events.data ?? []).length === 0 ? (
            <EmptyState icon="clock" title="Событий нет" description="По вузу ещё ничего не происходило." />
          ) : (
            <>
              <div className={styles.events}>
                {(events.data ?? []).map((event) => (
                  <span key={event.id} className={styles.event}>
                    <span className={styles.eventIcon}>
                      <Icon name={EVENT_ICONS[event.kind]} size={16} />
                    </span>
                    <span className={styles.eventText}>
                      <span className={styles.eventTitle}>
                        {event.cooperationId ? (
                          <a href={cooperationHref(event.cooperationId)}>{event.title}</a>
                        ) : (
                          event.title
                        )}
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
              {/* `hasMore` приходит в meta ленты: пока он есть, показываем «ещё» — до предела запроса. */}
              {(events.meta as { hasMore?: boolean } | null)?.hasMore &&
                (eventsLimit < UNIVERSITY_EVENTS_MAX_LIMIT ? (
                  <div className={styles.center}>
                    <Button
                      variant="secondary"
                      icon="chevronDown"
                      onClick={() =>
                        setEventsLimit((value) => Math.min(value + 20, UNIVERSITY_EVENTS_MAX_LIMIT))
                      }
                    >
                      Показать ещё
                    </Button>
                  </div>
                ) : (
                  <p className={styles.rowMeta}>
                    Показаны последние {UNIVERSITY_EVENTS_MAX_LIMIT} событий.
                  </p>
                ))}
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
      {anonymizing && (
        <Modal
          isOpen
          onClose={() => setAnonymizing(null)}
          title="Удалить персональные данные контакта"
          description="Необратимо. ФИО, должность, почта, телефон и заметки будут стёрты, запись останется как «Контакт удалён» — ради встреч и истории работы с вузом."
          closeOnBackdrop={false}
          footer={
            <>
              <Button variant="ghost" onClick={() => setAnonymizing(null)}>
                Отмена
              </Button>
              <Button variant="danger" onClick={confirmAnonymize} isLoading={anonymize.isPending}>
                Удалить данные
              </Button>
            </>
          }
        >
          <p className={styles.rowMeta}>
            Контакт: {anonymizing.fullName}
            {anonymizing.position ? `, ${anonymizing.position}` : ''}. Делайте это по запросу
            самого человека или когда сотрудничество с вузом прекращено и срок хранения истёк.
          </p>
        </Modal>
      )}
    </>
  )
}
