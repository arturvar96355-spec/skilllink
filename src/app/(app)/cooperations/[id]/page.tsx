'use client'

import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { CONTROL_POINT_STAGES, SIGNING_STAGE_NUMBER } from '@/shared/config/workflow.config'
import {
  MEETING_FORMAT_LABELS,
  RECOMMENDATION_SORT_MOST_IMPORTANT,
  type CooperationDto,
  type DocumentListItemDto,
  type DocumentPackageResultDto,
  type MeetingDto,
  type ProductDto,
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
  NO_DATA,
  PageHeader,
  PriorityBadge,
  Progress,
  RecommendationStatusBadge,
  Section,
  Skeleton,
  TableSkeleton,
  Tabs,
  TransferStatusBadge,
  OPEN_RECOMMENDATION_STATUSES,
  CLOSED_RECOMMENDATION_STATUSES,
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
import { AiAssistCard } from '../../AiDraft'
import { WhyNoRecommendation } from '../../RuleChecks'
import { ChangeResponsibleModal } from '../../ChangeResponsibleModal'
import { EditMeetingModal } from '../../EditMeetingModal'
import { ChangeCooperationStatusModal } from './ChangeCooperationStatusModal'
import { CooperationChain } from './CooperationChain'
import { CreateMeetingModal } from './CreateMeetingModal'
import { LicenseModal } from './LicenseModal'
import { licenseTermYearsText } from './license'
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
  const [isMeetingOpen, setIsMeetingOpen] = useState(false)
  const [isLicenseOpen, setIsLicenseOpen] = useState(false)
  // Смена статуса связки (задача «Данные без экрана», пункт 1) — по праву canWrite,
  // как и остальные правки связки.
  const [isStatusOpen, setIsStatusOpen] = useState(false)
  // Смена ответственного связки (ТЗ — роль «Руководитель», решение 146):
  // кнопка видна только с правом ASSIGN_RESPONSIBLE (ADMIN, HEAD).
  const [changingResponsible, setChangingResponsible] = useState(false)
  // Этап, к которому нужно перейти: приходит ссылкой из уведомления
  // или выбирается щелчком по ленте.
  const [focusStageId, setFocusStageId] = useState<string | null>(highlightedStageId)

  // Ссылка из уведомления на эту же связку страницу не пересоздаёт: меняется только
  // параметр. Без этого переход по второму уведомлению не делал ничего.
  useEffect(() => {
    if (highlightedStageId === null) return
    setTab('stages')
    setFocusStageId(highlightedStageId)
  }, [highlightedStageId])

  const cooperation = useResource<CooperationDto>(`/api/cooperations/${params.id}`)
  // Вендор продукта — только для блока «Лицензия и передача ПО»: у связки
  // (решение 145) есть только `productId`/`productName`, вендор — поле продукта.
  const product = useResource<ProductDto>(
    cooperation.data?.productId ? `/api/products/${cooperation.data.productId}` : null,
  )

  // Документы и встречи связки грузятся только при открытии своей вкладки.
  const documents = useResource<DocumentListItemDto[]>(
    tab === 'documents'
      ? `/api/documents${buildQuery({ cooperationId: params.id, pageSize: 50 })}`
      : null,
  )
  // Подписанные договор и лицензия — рядом с чек-листом этапа 6 (решение 87).
  const signedDocuments = useResource<DocumentListItemDto[]>(
    tab === 'stages'
      ? `/api/documents${buildQuery({ cooperationId: params.id, status: ['SIGNED'], type: ['AGREEMENT', 'LICENSE'], pageSize: 20 })}`
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
  // Как в общей ленте (решение 128): сначала открытые, закрытые — переключателем.
  const [adviceScope, setAdviceScope] = useState<'open' | 'closed'>('open')
  const advice = useResource<RecommendationDto[]>(
    user.permissions.canSeeAnalytics && tab === 'recommendations'
      ? `/api/recommendations${buildQuery({
          cooperationId: params.id,
          status: adviceScope === 'open' ? OPEN_RECOMMENDATION_STATUSES : CLOSED_RECOMMENDATION_STATUSES,
          sort: RECOMMENDATION_SORT_MOST_IMPORTANT,
          pageSize: 50,
        })}`
      : null,
  )
  // Изменённый этап показываем сразу, из ответа PATCH, — но связку после этого
  // перечитываем: сервер меняет не только его. Этап 14 пересчитывается сам
  // (решение 2), а с ним прогресс, текущий этап и лента. Раньше страница брала
  // только изменённый этап, и после «Начать этап» на новой связке этап 14 так
  // и оставался «Не начат».
  const [patchedStages, setPatchedStages] = useState<Record<string, WorkflowStageDto>>({})
  useEffect(() => setPatchedStages({}), [cooperation.data])
  const [packageResult, setPackageResult] = useState<DocumentPackageResultDto | null>(null)
  // Правка встречи (задача «Данные без экрана», пункт 2) — по образцу CreateMeetingModal.
  const [editingMeeting, setEditingMeeting] = useState<MeetingDto | null>(null)

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
    // Пустая вкладка сама предлагает эту кнопку — после сборки в ней должны
    // появиться собранные документы.
    documents.reload()
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
            {user.permissions.canWrite && (
              <Button size="sm" variant="ghost" onClick={() => setIsStatusOpen(true)}>
                Сменить статус
              </Button>
            )}
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
          universityShortName={data.universityShortName}
          programId={data.programId}
          programName={data.programName}
          productId={data.productId}
          productName={data.productName}
          stage={
            data.currentStage
              ? {
                  number: data.currentStage.stageNumber,
                  title: data.currentStage.title,
                  isProblem: data.currentStage.isOverdue || data.currentStage.status === 'BLOCKED',
                  total: data.stages.length,
                }
              : null
          }
        />
      </Card>

      <div className={styles.head}>
        <Card>
          <div className={styles.facts}>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Ответственный</span>
              <span className={[styles.factValue, styles.responsibleValue].join(' ')}>
                {data.responsible.fullName}
                {user.permissions.canAssignResponsible && (
                  <Button size="sm" variant="ghost" onClick={() => setChangingResponsible(true)}>
                    Сменить
                  </Button>
                )}
              </span>
            </span>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Первый контакт</span>
              <span className={styles.factValue}>{formatDate(data.firstContactAt)}</span>
            </span>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Контрольная дата</span>
              <span className={styles.factValue}>{formatDate(data.targetDate)}</span>
            </span>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Начало занятий</span>
              <span className={styles.factValue}>{formatDate(data.classesStartAt)}</span>
            </span>
            {data.closedAt && (
              <span className={styles.fact}>
                <span className={styles.factLabel}>Закрыта</span>
                <span className={styles.factValue}>{formatDate(data.closedAt)}</span>
              </span>
            )}
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
        title="Лицензия и передача ПО"
        description="Реквизиты договора и статус передачи продукта вузу — колонки «Каталога по ТЗ». Вендор и ПО показаны по выбранному продукту связки."
        action={
          user.permissions.canWrite ? (
            <Button variant="secondary" size="sm" onClick={() => setIsLicenseOpen(true)}>
              Изменить
            </Button>
          ) : undefined
        }
      >
        <Card>
          <div className={styles.facts}>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Вендор</span>
              <span className={styles.factValue}>{product.data?.vendor?.name ?? NO_DATA}</span>
            </span>
            <span className={styles.fact}>
              <span className={styles.factLabel}>ПО</span>
              <span className={styles.factValue}>{data.productName ?? NO_DATA}</span>
            </span>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Номер договора</span>
              <span className={styles.factValue}>{data.contractNumber ?? NO_DATA}</span>
            </span>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Подписание лицензии</span>
              <span className={styles.factValue}>{formatDate(data.licenseSignedAt)}</span>
            </span>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Срок действия лицензии</span>
              <span className={styles.factValue}>{licenseTermYearsText(data.licenseTermYears)}</span>
            </span>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Статус по передаче</span>
              <span className={styles.factValue}>
                {data.transferStatus ? <TransferStatusBadge status={data.transferStatus} /> : NO_DATA}
              </span>
            </span>
          </div>
          {data.comment && <p className={styles.goal}>{data.comment}</p>}
        </Card>
      </Section>

      {isLicenseOpen && (
        <LicenseModal
          cooperation={data}
          onClose={(updated) => {
            setIsLicenseOpen(false)
            if (updated) cooperation.reload()
          }}
        />
      )}

      {isStatusOpen && (
        <ChangeCooperationStatusModal
          cooperation={data}
          onClose={(updated) => {
            setIsStatusOpen(false)
            if (updated) cooperation.reload()
          }}
        />
      )}

      <Section
        title="Ход работы"
        description="Четырнадцатый этап система закрывает сама, когда закрыты остальные. Этапы 6, 7 и 11 — контрольные точки: их не начать, пока не закрыты предыдущие, а следующие за ними — пока точка не завершена."
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
              signedDocuments={stage.stageNumber === SIGNING_STAGE_NUMBER ? (signedDocuments.data ?? []) : undefined}
              onStageChanged={(updated) => {
                setPatchedStages((current) => ({ ...current, [updated.id]: updated }))
                cooperation.reload()
              }}
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
              total={documents.meta?.total}
              columns={documentColumns}
              getRowKey={(row) => row.id}
              getRowHref={(row) => documentHref(row.id)}
              caption="Документы связки"
            />
          )}
        </Card>
      )}

      {tab === 'meetings' && user.permissions.canWrite && (
        <div className={styles.tabActions}>
          <Button icon="plus" variant="secondary" onClick={() => setIsMeetingOpen(true)}>
            Записать встречу
          </Button>
        </div>
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
                  {meeting.participants.length > 0 && (
                    <span className={styles.blockText}>
                      Участники:{' '}
                      {meeting.participants
                        .map((person) => (person.position ? `${person.name} (${person.position})` : person.name))
                        .join(', ')}
                    </span>
                  )}
                  <span className={styles.factLabel}>
                    {formatDateTime(meeting.date)} · {MEETING_FORMAT_LABELS[meeting.format]} ·{' '}
                    {meeting.responsible.fullName}
                  </span>
                  {user.permissions.canWrite && (
                    <Button variant="ghost" size="sm" onClick={() => setEditingMeeting(meeting)}>
                      Изменить
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {isMeetingOpen && (
        <CreateMeetingModal
          cooperationId={params.id}
          onClose={(created) => {
            setIsMeetingOpen(false)
            if (created) meetings.reload()
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

      {changingResponsible && (
        <ChangeResponsibleModal
          title="Сменить ответственного связки"
          description="У связки всегда есть ответственный — снять его нельзя, только назначить другого."
          consequence="Смена попадёт в журнал действий. Ответственные за отдельные этапы не меняются."
          endpoint={`/api/cooperations/${params.id}`}
          currentResponsibleId={data.responsible.id}
          currentResponsibleName={data.responsible.fullName}
          onClose={(changed) => {
            setChangingResponsible(false)
            if (changed) cooperation.reload()
          }}
        />
      )}

      {tab === 'recommendations' && (
        <AiAssistCard
          key={params.id}
          title="Сводка"
          description="Где связка сейчас, что мешает и что сделать дальше — по этапам и открытым рекомендациям. Текст пишет ИИ-помощник, если он подключён, иначе — шаблон."
          actionLabel="Составить сводку"
          endpoint={`/api/cooperations/${params.id}/ai-summary`}
        />
      )}

      {tab === 'recommendations' && (
        <Card>
          <Tabs
            items={[
              { key: 'open', label: 'Открытые' },
              { key: 'closed', label: 'Закрытые' },
            ]}
            active={adviceScope}
            onChange={(key) => setAdviceScope(key === 'closed' ? 'closed' : 'open')}
          />
          {advice.isLoading ? (
            <TableSkeleton rows={3} columns={2} />
          ) : advice.error ? (
            <ErrorState error={advice.error} onRetry={advice.reload} />
          ) : (advice.data ?? []).length === 0 ? (
            <EmptyState
              icon="recommendation"
              title={adviceScope === 'open' ? 'Открытых предложений нет' : 'Закрытых предложений нет'}
              description={
                adviceScope === 'open'
                  ? 'По этой связке система сейчас ничего не предлагает. Пересобрать предложения можно на странице рекомендаций.'
                  : 'Выполненных и отклонённых предложений по этой связке пока нет.'
              }
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
          {/* «Почему нет» — по всем правилам связки: и когда предложений нет вовсе,
              и когда видно не всё, что ожидали (ТЗ дизайна 26–29.09, п. 4.1). */}
          {adviceScope === 'open' && !advice.isLoading && !advice.error && (
            <div className={styles.whyNot}>
              <WhyNoRecommendation entity="cooperation" id={params.id} />
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
                <Link key={item.document.id} className={styles.factLink} href={documentHref(item.document.id)}>
                  {item.document.title}
                </Link>
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
                  {item.templateName} — {item.reason}
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
                {capitalize(packageResult.missingFieldLabels.join(', '))}. В тексте на их месте
                стоит прочерк — допишите их в документе или в карточках вуза, программы и связки.
              </span>
            </p>
          )}
        </Modal>
      )}
    </>
  )
}

/** Список реквизитов начинается с заглавной: подписи в словаре — строчные, для середины фразы. */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
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
