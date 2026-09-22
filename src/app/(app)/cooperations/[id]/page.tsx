'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { Suspense, useMemo, useState } from 'react'
import { CONTROL_POINT_STAGES } from '@/shared/config/workflow.config'
import {
  MEETING_FORMAT_LABELS,
  type CooperationDto,
  type DocumentListItemDto,
  type DocumentPackageResultDto,
  type MeetingDto,
  type RecommendationDto,
  type WorkflowStageDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  CooperationStatusBadge,
  DataTable,
  DocumentStatusBadge,
  EmptyState,
  ErrorState,
  Icon,
  MockBadge,
  Modal,
  PageHeader,
  PriorityBadge,
  Progress,
  RecommendationStatusBadge,
  Section,
  Skeleton,
  TableSkeleton,
  Tabs,
  apiPost,
  buildQuery,
  documentHref,
  formatDate,
  formatDateTime,
  formatNumber,
  recommendationHref,
  universityHref,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
  type Column,
  type TabItem,
} from '@/ui'
import { CooperationChain } from './CooperationChain'
import { StageCard } from './StageCard'
import { StageRibbon } from './StageRibbon'
import styles from './cooperation.module.css'

/**
 * Карточка связки — главный экран системы.
 *
 * Здесь видно то, чего нет в таблице: четырнадцать этапов, их чек-листы
 * и отказы системы. Этапы приходят вместе со связкой одним запросом, поэтому
 * отдельного обращения к `/api/cooperations/:id/stages` тут нет.
 */
function CooperationContent() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const highlightedStageId = searchParams.get('stage')
  const user = useCurrentUser()
  const toast = useToast()

  const [tab, setTab] = useState<'stages' | 'documents' | 'meetings' | 'recommendations'>('stages')
  // Этап, к которому нужно перейти: приходит ссылкой из уведомления
  // или выбирается щелчком по ленте.
  const [focusStageId, setFocusStageId] = useState<string | null>(highlightedStageId)

  const cooperation = useResource<CooperationDto>(`/api/cooperations/${params.id}`)

  // Документы и встречи связки грузятся только при открытии своей вкладки.
  const documents = useResource<DocumentListItemDto[]>(
    tab === 'documents'
      ? `/api/documents${buildQuery({ cooperationId: params.id, pageSize: 50 })}`
      : null,
  )
  const meetings = useResource<MeetingDto[]>(
    tab === 'meetings'
      ? `/api/meetings${buildQuery({ cooperationId: params.id, pageSize: 50 })}`
      : null,
  )
  /**
   * Что система предлагает сделать именно по этой связке.
   *
   * Раньше за этим приходилось уходить на общую страницу рекомендаций
   * и искать там нужную строку глазами. Ролям без аналитики раздел закрыт
   * на сервере, поэтому вкладки у них нет.
   */
  const advice = useResource<RecommendationDto[]>(
    user.permissions.canSeeAnalytics && tab === 'recommendations'
      ? `/api/recommendations${buildQuery({ cooperationId: params.id, sort: 'priority', pageSize: 50 })}`
      : null,
  )
  // Этапы держим отдельным состоянием: ответ PATCH возвращает изменённый этап
  // целиком, и перезапрашивать всю связку ради одного поля незачем.
  const [patchedStages, setPatchedStages] = useState<Record<string, WorkflowStageDto>>({})
  const [packageResult, setPackageResult] = useState<DocumentPackageResultDto | null>(null)

  const generatePackage = useMutation(async () => {
    const result = await apiPost<DocumentPackageResultDto>(
      `/api/cooperations/${params.id}/documents/generate`,
    )
    return result.data
  })

  const stages = useMemo(() => {
    const original = cooperation.data?.stages ?? []
    return original.map((stage) => patchedStages[stage.id] ?? stage)
  }, [cooperation.data, patchedStages])

  async function onGeneratePackage() {
    const result = await generatePackage.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setPackageResult(result.data)
  }

  if (cooperation.isLoading) {
    return (
      <>
        <Skeleton width="360px" height="30px" />
        <Skeleton height="160px" radius="20px" />
        <Skeleton height="420px" radius="20px" />
      </>
    )
  }

  if (cooperation.error) {
    return <ErrorState error={cooperation.error} onRetry={cooperation.reload} />
  }

  const data = cooperation.data
  if (!data) return null

  // Прогресс пересчитываем по этапам, которые сейчас на экране: после изменения
  // статуса полоса должна двигаться сразу, а не после перезагрузки страницы.
  const countableStages = stages.filter((stage) => !stage.isAutoManaged)
  const closedStages = countableStages.filter(
    (stage) => stage.status === 'COMPLETED' || stage.status === 'CANCELLED',
  ).length
  const overdueStages = stages.filter((stage) => stage.isOverdue).length
  const dueSoonStages = stages.filter((stage) => stage.isDueSoon).length
  const blockedStages = stages.filter((stage) => stage.status === 'BLOCKED').length
  const percent =
    countableStages.length === 0 ? 0 : Math.round((closedStages / countableStages.length) * 100)

  const tabs: TabItem[] = [
    { key: 'stages', label: 'Этапы', count: stages.length },
    { key: 'documents', label: 'Документы' },
    { key: 'meetings', label: 'Встречи' },
  ]
  if (user.permissions.canSeeAnalytics) {
    tabs.push({ key: 'recommendations', label: 'Рекомендации' })
  }

  const documentColumns: Column<DocumentListItemDto>[] = [
    {
      key: 'title',
      title: 'Документ',
      render: (row) => (
        <span className={styles.fact}>
          <span className={styles.factValue}>{row.title}</span>
          <span className={styles.factLabel}>версия {row.version}</span>
        </span>
      ),
    },
    {
      key: 'status',
      title: 'Статус',
      width: '160px',
      render: (row) => <DocumentStatusBadge status={row.status} />,
    },
    {
      key: 'updatedAt',
      title: 'Обновлён',
      width: '150px',
      render: (row) => <span className={styles.factLabel}>{formatDate(row.updatedAt)}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title={`${data.universityName} — ${data.programName}`}
        breadcrumbs={[
          { label: 'Сотрудничество', href: '/cooperations' },
          { label: data.universityName, href: universityHref(data.universityId) },
          { label: data.programName },
        ]}
        meta={
          <>
            <CooperationStatusBadge status={data.status} />
            {data.isMock && <MockBadge />}
          </>
        }
        actions={
          user.permissions.canWrite ? (
            <Button
              icon="document"
              variant="secondary"
              onClick={onGeneratePackage}
              isLoading={generatePackage.isPending}
            >
              Собрать пакет документов
            </Button>
          ) : undefined
        }
      />

      {/* Схема связки идёт во всю ширину: это единица учёта системы,
          и делить её на колонки с чем-то ещё нельзя. */}
      <Card>
        <CooperationChain
          universityId={data.universityId}
          universityName={data.universityName}
          programId={data.programId}
          programName={data.programName}
          productId={data.productId}
          productName={data.productName}
        />
      </Card>

      <div className={styles.head}>
        <Card>
          <div className={styles.facts}>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Ответственный</span>
              <span className={styles.factValue}>{data.responsible.fullName}</span>
            </span>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Контрольная дата</span>
              <span className={styles.factValue}>{formatDate(data.targetDate)}</span>
            </span>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Начало занятий</span>
              <span className={styles.factValue}>{formatDate(data.classesStartAt)}</span>
            </span>
          </div>
          {data.goal && <p className={styles.goal}>{data.goal}</p>}
          {data.notes && <p className={styles.goal}>{data.notes}</p>}
        </Card>

        <Card className={styles.progressCard}>
          <span className={styles.factLabel}>Пройдено этапов</span>
          <span className={styles.progressValue}>
            {closedStages}
            <span style={{ fontSize: 'var(--text-kpi-sm-size)', color: 'var(--text-secondary)' }}>
              {' '}
              из {countableStages.length}
            </span>
          </span>
          <Progress value={percent} tone={overdueStages > 0 ? 'danger' : 'default'} label="Прогресс связки" />
          <div className={styles.progressCounts}>
            {overdueStages > 0 && <Badge tone="danger" withDot>Просрочено: {overdueStages}</Badge>}
            {dueSoonStages > 0 && <Badge tone="warning" withDot>Скоро срок: {dueSoonStages}</Badge>}
            {blockedStages > 0 && <Badge tone="warning" withDot>Заблокировано: {blockedStages}</Badge>}
            {overdueStages === 0 && blockedStages === 0 && (
              <Badge tone="success" withDot>
                Просрочек нет
              </Badge>
            )}
          </div>
        </Card>
      </div>

      <Section
        title="Ход работы"
        description="Четырнадцатый этап система закрывает сама, когда закрыты остальные. Этапы 6, 7 и 11 — контрольные точки: начать их, пока не закрыты предыдущие, нельзя."
      >
        <StageRibbon
          stages={stages}
          controlPoints={CONTROL_POINT_STAGES}
          selectedStageId={focusStageId}
          onSelect={(stageId) => {
            setTab('stages')
            setFocusStageId(stageId)
          }}
        />

      </Section>

      <Tabs items={tabs} active={tab} onChange={(key) => setTab(key as typeof tab)} />

      {tab === 'stages' && (
        <div className={styles.stages}>
          {stages.map((stage) => (
            <StageCard
              key={stage.id}
              stage={stage}
              canWrite={user.permissions.canWrite}
              isHighlighted={stage.id === focusStageId}
              onStageChanged={(updated) =>
                setPatchedStages((current) => ({ ...current, [updated.id]: updated }))
              }
            />
          ))}
        </div>
      )}

      {tab === 'documents' && (
        <Card padding="none">
          {documents.isLoading ? (
            <TableSkeleton rows={4} columns={3} />
          ) : documents.error ? (
            <ErrorState error={documents.error} onRetry={documents.reload} />
          ) : (documents.data ?? []).length === 0 ? (
            <EmptyState
              icon="document"
              title="Документов нет"
              description="По связке ещё не заведено ни одного документа. Пакет можно собрать из шаблонов кнопкой в заголовке страницы."
            />
          ) : (
            <DataTable
              rows={documents.data ?? []}
              columns={documentColumns}
              getRowKey={(row) => row.id}
              getRowHref={(row) => documentHref(row.id)}
              caption="Документы связки"
            />
          )}
        </Card>
      )}

      {tab === 'meetings' && (
        <Card>
          {meetings.isLoading ? (
            <TableSkeleton rows={3} columns={2} />
          ) : meetings.error ? (
            <ErrorState error={meetings.error} onRetry={meetings.reload} />
          ) : (meetings.data ?? []).length === 0 ? (
            <EmptyState
              icon="calendar"
              title="Встреч нет"
              description="Встречи по этой связке не зафиксированы."
            />
          ) : (
            <div className={styles.stages}>
              {(meetings.data ?? []).map((meeting) => (
                <div key={meeting.id} className={styles.block}>
                  <span className={styles.factValue}>{meeting.topic}</span>
                  {meeting.result && <span className={styles.blockText}>{meeting.result}</span>}
                  {meeting.nextAction && (
                    <span className={styles.blockText}>
                      Следующий шаг: {meeting.nextAction}
                      {meeting.nextActionDueAt && ` до ${formatDate(meeting.nextActionDueAt)}`}
                    </span>
                  )}
                  <span className={styles.factLabel}>
                    {formatDateTime(meeting.date)} · {MEETING_FORMAT_LABELS[meeting.format]} ·{' '}
                    {meeting.responsible.fullName}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'recommendations' && (
        <Card>
          {advice.isLoading ? (
            <TableSkeleton rows={3} columns={2} />
          ) : advice.error ? (
            <ErrorState error={advice.error} onRetry={advice.reload} />
          ) : (advice.data ?? []).length === 0 ? (
            <EmptyState
              icon="recommendation"
              title="Предложений нет"
              description="По этой связке система пока ничего не предлагает. Пересобрать их можно на странице рекомендаций."
            />
          ) : (
            <div className={styles.adviceList}>
              {(advice.data ?? []).map((item) => (
                <div key={item.id} className={styles.advice}>
                  <div className={styles.adviceHead}>
                    <span className={styles.adviceTitle}>{item.title}</span>
                    <span className={styles.progressCounts}>
                      <PriorityBadge priority={item.priority} />
                      <RecommendationStatusBadge status={item.status} />
                    </span>
                  </div>
                  <span className={styles.blockText}>{item.description}</span>
                  <span className={styles.adviceWhy}>{item.justification}</span>
                  <Button
                    href={recommendationHref(item.id)}
                    variant="ghost"
                    size="sm"
                    icon="arrowRight"
                    iconPosition="right"
                  >
                    Подробности
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {packageResult && (
        <Modal
          isOpen
          onClose={() => setPackageResult(null)}
          title="Пакет документов собран"
          description="Тексты собраны из шаблонов с подстановкой реквизитов связки."
          wide
          footer={
            <Button variant="primary" onClick={() => setPackageResult(null)}>
              Понятно
            </Button>
          }
        >
          {packageResult.created.length > 0 ? (
            <div className={styles.block}>
              <span className={styles.blockLabel}>Создано документов: {packageResult.created.length}</span>
              {packageResult.created.map((item) => (
                <a key={item.document.id} className={styles.factLink} href={documentHref(item.document.id)}>
                  {item.document.title}
                </a>
              ))}
            </div>
          ) : (
            <p className={styles.blockText}>Новых документов не создано.</p>
          )}

          {packageResult.skipped.length > 0 && (
            <div className={styles.block}>
              <span className={styles.blockLabel}>Пропущено</span>
              {packageResult.skipped.map((item) => (
                <span key={item.templateKey} className={styles.blockText}>
                  {item.templateKey}: {item.reason}
                </span>
              ))}
            </div>
          )}

          {packageResult.missingFields.length > 0 && (
            <p className={styles.refusal}>
              <Icon name="alert" size={20} />
              <span>
                <span className={styles.refusalTitle}>
                  Не хватает реквизитов: {formatNumber(packageResult.missingFields.length)}
                </span>
                {packageResult.missingFields.join(', ')}. В тексте на их месте стоит прочерк —
                документ с невидимой дырой подписали бы не глядя.
              </span>
            </p>
          )}
        </Modal>
      )}
    </>
  )
}

/**
 * Ссылка из уведомления приходит с `?stage=…`, а чтение параметров адреса
 * требует границы Suspense — без неё страница не собирается.
 */
export default function CooperationPage() {
  return (
    <Suspense fallback={<Skeleton height="420px" radius="20px" />}>
      <CooperationContent />
    </Suspense>
  )
}
