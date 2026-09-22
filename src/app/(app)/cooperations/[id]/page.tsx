'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { Suspense, useMemo, useState } from 'react'
import {
  STAGE_PHASES,
  STAGE_PHASE_LABELS,
  type CooperationDto,
  type DocumentPackageResultDto,
  type StagePhase,
  type WorkflowStageDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  CooperationStatusBadge,
  ErrorState,
  Icon,
  MockBadge,
  Modal,
  PageHeader,
  Progress,
  Section,
  Skeleton,
  apiPost,
  documentHref,
  formatDate,
  formatNumber,
  programHref,
  universityHref,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
} from '@/ui'
import { StageCard } from './StageCard'
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

  const cooperation = useResource<CooperationDto>(`/api/cooperations/${params.id}`)
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

  const phaseSummary = useMemo(() => {
    return STAGE_PHASES.map((phase: StagePhase) => {
      const inPhase = stages.filter((stage) => stage.phase === phase)
      const closed = inPhase.filter(
        (stage) => stage.status === 'COMPLETED' || stage.status === 'CANCELLED',
      ).length
      const isCurrent = inPhase.some((stage) => stage.status === 'IN_PROGRESS')
      const hasOverdue = inPhase.some((stage) => stage.isOverdue)
      return { phase, total: inPhase.length, closed, isCurrent, hasOverdue }
    })
  }, [stages])

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

      <div className={styles.head}>
        <Card>
          <div className={styles.facts}>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Университет</span>
              <a className={[styles.factValue, styles.factLink].join(' ')} href={universityHref(data.universityId)}>
                {data.universityName}
              </a>
            </span>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Программа</span>
              <a className={[styles.factValue, styles.factLink].join(' ')} href={programHref(data.programId)}>
                {data.programName}
              </a>
            </span>
            <span className={styles.fact}>
              <span className={styles.factLabel}>IT-продукт</span>
              <span className={styles.factValue}>{data.productName ?? 'Не выбран'}</span>
            </span>
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
        title="Этапы работы"
        description="Четырнадцатый этап система закрывает сама, когда закрыты остальные. Этапы 6, 7 и 11 — контрольные точки: начать их, пока не закрыты предыдущие, нельзя."
      >
        <div className={styles.stepper}>
          {phaseSummary.map((phase) => (
            <div
              key={phase.phase}
              className={[styles.phase, phase.isCurrent ? styles.phaseCurrent : ''].filter(Boolean).join(' ')}
            >
              <span className={styles.phaseName}>{STAGE_PHASE_LABELS[phase.phase]}</span>
              <span className={styles.phaseCount}>
                {phase.closed} из {phase.total}
                {phase.hasOverdue && ' · есть просрочка'}
              </span>
              <Progress
                value={phase.total === 0 ? 0 : (phase.closed / phase.total) * 100}
                tone={phase.hasOverdue ? 'danger' : 'default'}
                label={STAGE_PHASE_LABELS[phase.phase]}
              />
            </div>
          ))}
        </div>

        <div className={styles.stages}>
          {stages.map((stage) => (
            <StageCard
              key={stage.id}
              stage={stage}
              canWrite={user.permissions.canWrite}
              isHighlighted={stage.id === highlightedStageId}
              onStageChanged={(updated) =>
                setPatchedStages((current) => ({ ...current, [updated.id]: updated }))
              }
            />
          ))}
        </div>
      </Section>

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
