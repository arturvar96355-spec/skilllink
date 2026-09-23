'use client'

import { Suspense, useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  APPLICATION_STATUS_LABELS,
  PROGRAM_LEVEL_LABELS,
  type ApplicationDto,
  type PortalCooperationDto,
  type PortalMaterialDto,
  type PortalOverviewDto,
  type PortalProgramDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  CardsSkeleton,
  CooperationStatusBadge,
  DataTable,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  KpiCard,
  Modal,
  NO_DATA,
  PageHeader,
  Pagination,
  Progress,
  Section,
  Select,
  StageStatusBadge,
  TableSkeleton,
  Textarea,
  apiPatch,
  apiPost,
  buildQuery,
  fieldErrors,
  formatDate,
  formatDateTime,
  formatNumber,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
  usePageInRange,
  type Column,
} from '@/ui'
import styles from './portal.module.css'

/**
 * Кабинет представителя вуза (шаг 5 демонстрационного сценария).
 *
 * Здесь нет аналитики, рейтингов и чужих вузов — решение 9 проекта. Всё, что
 * может вуз: видеть свои программы и связки, подтверждать получение материалов,
 * вносить численность обучающихся и групп и подавать заявки на обучение.
 */

/** Пустое поле — это «Нет данных», а не ноль: сервер принимает null и стирает значение. */
function toCount(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  return Number(trimmed)
}

function errorFor(error: unknown, field: string): string | null {
  return fieldErrors(error).find((item) => item.field === field)?.message ?? null
}

/** Подсказка для тех, кто зашёл сюда не представителем вуза. */
function RepHint() {
  return (
    <Card muted padding="sm">
      <p className={styles.hint}>
        <Icon name="info" size={16} />
        Раздел предназначен представителям вузов. Сотрудник ИТ-Школы открывает кабинет
        конкретного вуза, добавив к адресу параметр <code>?universityId=…</code>.
      </p>
    </Card>
  )
}

export default function PortalPage() {
  // useSearchParams требует границы Suspense: без неё страница не пройдёт сборку.
  return (
    <Suspense fallback={<CardsSkeleton count={4} />}>
      <PortalScreen />
    </Suspense>
  )
}

function PortalScreen() {
  const user = useCurrentUser()
  const toast = useToast()
  const params = useSearchParams()

  const isRep = user.role === 'UNIVERSITY_REP'
  // Представитель вуза работает только со своим вузом. Сотрудник ИТ-Школы обязан
  // указать вуз параметром — иначе сервер ответит 404 с объяснением (раздел 13 контракта).
  const universityId = isRep ? undefined : (params.get('universityId') ?? undefined)
  const scope = buildQuery({ universityId })

  const [page, setPage] = useState(1)

  const overview = useResource<PortalOverviewDto>(`/api/portal/overview${scope}`)
  const materials = useResource<PortalMaterialDto[]>(`/api/portal/materials${scope}`)
  const applications = useResource<ApplicationDto[]>(
    `/api/portal/applications${buildQuery({ universityId, page, pageSize: 10 })}`,
    { keepPreviousData: true },
  )
  usePageInRange(page, setPage, applications.meta)

  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [metricsProgram, setMetricsProgram] = useState<PortalProgramDto | null>(null)
  const [studentCount, setStudentCount] = useState('')
  const [groupCount, setGroupCount] = useState('')
  const [applicationProgramId, setApplicationProgramId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [comment, setComment] = useState('')

  const confirmMaterial = useMutation(async (taskId: string) => {
    const result = await apiPost<PortalMaterialDto[]>(`/api/portal/materials/${taskId}/confirm${scope}`)
    return result.data
  })

  const saveMetrics = useMutation(
    async (input: { programId: string; studentCount: number | null; groupCount: number | null }) => {
      const result = await apiPatch<PortalProgramDto>(
        `/api/portal/programs/${input.programId}/metrics${scope}`,
        { studentCount: input.studentCount, groupCount: input.groupCount },
      )
      return result.data
    },
  )

  const submitApplication = useMutation(
    async (input: { programId: string; quantity: number; comment: string | null }) => {
      const result = await apiPost<ApplicationDto>(`/api/portal/applications${scope}`, input)
      return result.data
    },
  )

  const data = overview.data
  const canAct = user.permissions.canUsePortal

  async function onConfirm(taskId: string) {
    setConfirmingId(taskId)
    const result = await confirmMaterial.run(taskId)
    setConfirmingId(null)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Получение материалов подтверждено')
    materials.reload()
    overview.reload()
  }

  function openMetrics(program: PortalProgramDto) {
    saveMetrics.reset()
    setMetricsProgram(program)
    setStudentCount(program.studentCount === null ? '' : String(program.studentCount))
    setGroupCount(program.groupCount === null ? '' : String(program.groupCount))
  }

  async function onSaveMetrics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!metricsProgram) return

    const result = await saveMetrics.run({
      programId: metricsProgram.id,
      studentCount: toCount(studentCount),
      groupCount: toCount(groupCount),
    })
    if (!result.ok) {
      // Ошибку валидации показывает само поле; остальные отказы — сообщением.
      if (fieldErrors(result.error).length === 0) toast.error(result.error.message)
      return
    }

    toast.success(`Показатели программы «${result.data.name}» сохранены`)
    setMetricsProgram(null)
    overview.reload()
  }

  async function onSubmitApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const result = await submitApplication.run({
      programId: applicationProgramId,
      quantity: Number(quantity),
      comment: comment.trim() === '' ? null : comment.trim(),
    })
    if (!result.ok) {
      if (fieldErrors(result.error).length === 0) toast.error(result.error.message)
      return
    }

    toast.success(
      `Заявка принята: ${formatNumber(result.data.quantity)} на «${result.data.programName}»`,
    )
    setQuantity('')
    setComment('')
    setPage(1)
    applications.reload()
    overview.reload()
  }

  const cooperationColumns: Column<PortalCooperationDto>[] = [
    {
      key: 'program',
      title: 'Программа',
      render: (row) => (
        <span className={styles.cell}>
          <span className={styles.cellTitle}>{row.programName}</span>
          <span className={styles.cellMeta}>{row.productName ?? 'Продукт не выбран'}</span>
        </span>
      ),
    },
    {
      key: 'status',
      title: 'Статус',
      width: '150px',
      render: (row) => <CooperationStatusBadge status={row.status} />,
    },
    {
      key: 'stage',
      title: 'Текущий этап',
      render: (row) =>
        row.currentStageNumber === null ? (
          <span className={styles.cellMeta}>{NO_DATA}</span>
        ) : (
          <span className={styles.cell}>
            <span className={styles.cellMeta}>
              Этап {row.currentStageNumber}: {row.currentStageTitle}
            </span>
            {row.currentStageStatus && <StageStatusBadge status={row.currentStageStatus} />}
          </span>
        ),
    },
    {
      key: 'progress',
      title: 'Готовность',
      width: '170px',
      render: (row) => <Progress value={row.progressPercent} withValue label="Готовность связки" />,
    },
    {
      key: 'classesStartAt',
      title: 'Начало занятий',
      width: '150px',
      render: (row) => <span className={styles.cellMeta}>{formatDate(row.classesStartAt)}</span>,
    },
  ]

  const programColumns: Column<PortalProgramDto>[] = [
    {
      key: 'name',
      title: 'Программа',
      render: (row) => (
        <span className={styles.cell}>
          <span className={styles.cellTitle}>{row.name}</span>
          <span className={styles.cellMeta}>{PROGRAM_LEVEL_LABELS[row.level]}</span>
        </span>
      ),
    },
    {
      key: 'applicationCount',
      title: 'Заявки',
      align: 'right',
      width: '110px',
      render: (row) => <span className={styles.number}>{formatNumber(row.applicationCount)}</span>,
    },
    {
      key: 'studentCount',
      title: 'Обучающихся',
      align: 'right',
      width: '130px',
      render: (row) => <span className={styles.number}>{formatNumber(row.studentCount)}</span>,
    },
    {
      key: 'groupCount',
      title: 'Групп',
      align: 'right',
      width: '100px',
      render: (row) => <span className={styles.number}>{formatNumber(row.groupCount)}</span>,
    },
    {
      key: 'metricsUpdatedAt',
      title: 'Обновлено',
      width: '160px',
      render: (row) => <span className={styles.cellMeta}>{formatDateTime(row.metricsUpdatedAt)}</span>,
    },
    {
      key: 'actions',
      title: 'Действия',
      align: 'right',
      width: '180px',
      render: (row) =>
        canAct ? (
          <Button size="sm" variant="ghost" icon="analytics" onClick={() => openMetrics(row)}>
            Внести показатели
          </Button>
        ) : (
          <span className={styles.cellMeta}>Только просмотр</span>
        ),
    },
  ]

  const applicationColumns: Column<ApplicationDto>[] = [
    {
      key: 'program',
      title: 'Программа',
      render: (row) => (
        <span className={styles.cell}>
          <span className={styles.cellTitle}>{row.programName}</span>
          {row.comment && <span className={styles.cellMeta}>{row.comment}</span>}
        </span>
      ),
    },
    {
      key: 'quantity',
      title: 'Заявок',
      align: 'right',
      width: '110px',
      render: (row) => <span className={styles.number}>{formatNumber(row.quantity)}</span>,
    },
    {
      key: 'status',
      title: 'Статус',
      width: '150px',
      render: (row) => <Badge tone="neutral" withDot>{APPLICATION_STATUS_LABELS[row.status]}</Badge>,
    },
    {
      key: 'submittedAt',
      title: 'Подана',
      width: '170px',
      render: (row) => <span className={styles.cellMeta}>{formatDateTime(row.submittedAt)}</span>,
    },
  ]

  const programOptions = (data?.programs ?? []).map((program) => ({
    value: program.id,
    label: program.name,
  }))

  // Отказ сервера (403 — роль без кабинета, 404 — сотрудник, не указавший вуз) показывается
  // один раз: материалы и заявки тем же запретом отвечают тому же человеку.
  if (overview.error) {
    return (
      <>
        <PageHeader
          title="Кабинет вуза"
          description="Программы вуза, ход работы по ним, материалы и заявки на обучение."
        />
        {!isRep && <RepHint />}
        <ErrorState error={overview.error} onRetry={overview.reload} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={data?.universityName ?? 'Кабинет вуза'}
        description="Ваши программы, ход работы по ним, переданные материалы и заявки на обучение."
        meta={
          data && data.pendingMaterials > 0 ? (
            <Badge tone="warning">Материалов ждут подтверждения: {data.pendingMaterials}</Badge>
          ) : undefined
        }
      />

      {!isRep && <RepHint />}

      {overview.isLoading ? (
        <CardsSkeleton count={4} />
      ) : data ? (
        <>
          <div className={styles.kpis}>
            <KpiCard label="Программы вуза" value={data.programs.length} />
            <KpiCard label="Сотрудничества" value={data.cooperations.length} />
            <KpiCard
              label="Материалы к подтверждению"
              value={data.pendingMaterials}
              explanation="Переданные вузу материалы, получение которых вы ещё не подтвердили."
            />
            <KpiCard label="Документы" value={data.documentsCount} />
          </div>

          <Section
            title="Сотрудничества"
            description="Ход работы по каждой программе: текущий этап и готовность."
          >
            <Card padding="none">
              {data.cooperations.length === 0 ? (
                <EmptyState
                  icon="cooperation"
                  title="Связок пока нет"
                  description="Работа по программам вуза ещё не начата."
                />
              ) : (
                <DataTable
                  rows={data.cooperations}
                  columns={cooperationColumns}
                  getRowKey={(row) => row.id}
                  isRefreshing={overview.isRefreshing}
                  caption="Сотрудничества вуза"
                />
              )}
            </Card>
          </Section>

          <Section
            title="Программы и показатели"
            description="Численность обучающихся и количество групп вносит вуз. Заявки считаются по поданным заявкам и вручную не правятся."
          >
            <Card padding="none">
              {data.programs.length === 0 ? (
                <EmptyState
                  icon="program"
                  title="Программ нет"
                  description="За вузом не закреплено ни одной образовательной программы."
                />
              ) : (
                <DataTable
                  rows={data.programs}
                  columns={programColumns}
                  getRowKey={(row) => row.id}
                  isRefreshing={overview.isRefreshing}
                  caption="Образовательные программы вуза"
                />
              )}
            </Card>
          </Section>
        </>
      ) : null}

      <Section
        title="Материалы"
        description="Учебные материалы, лицензии и документация, переданные вузу. Подтверждение получения закрывает пункт этапа 7."
      >
        {materials.isLoading ? (
          <CardsSkeleton count={2} />
        ) : materials.error ? (
          <ErrorState error={materials.error} onRetry={materials.reload} />
        ) : materials.data && materials.data.length > 0 ? (
          <div className={styles.list}>
            {materials.data.map((material) => (
              <Card key={material.taskId} padding="sm">
                <div className={styles.material}>
                  <div className={styles.cell}>
                    <span className={styles.cellTitle}>{material.title}</span>
                    <span className={styles.cellMeta}>
                      {material.programName}
                      {material.productName ? ` · ${material.productName}` : ''}
                    </span>
                    <span className={styles.cellMeta}>
                      Этап 7 · <StageStatusBadge status={material.stageStatus} />
                    </span>
                  </div>

                  {material.isConfirmed ? (
                    <div className={styles.confirmed}>
                      <Badge tone="success" withDot>
                        Получение подтверждено
                      </Badge>
                      <span className={styles.cellMeta}>{formatDateTime(material.confirmedAt)}</span>
                    </div>
                  ) : canAct ? (
                    <Button
                      icon="check"
                      variant="primary"
                      size="sm"
                      onClick={() => onConfirm(material.taskId)}
                      isLoading={confirmingId === material.taskId}
                      disabled={confirmMaterial.isPending}
                    >
                      Подтвердить получение
                    </Button>
                  ) : (
                    <Badge tone="neutral">Ожидает подтверждения вузом</Badge>
                  )}
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card muted>
            <EmptyState
              icon="document"
              title="Материалов нет"
              description="Вузу ещё ничего не передано: пункты этапа 7 появятся здесь, когда работа дойдёт до передачи материалов."
            />
          </Card>
        )}
      </Section>

      <Section
        title="Заявки на обучение"
        description="Заявка содержит только количество: персональных данных обучающихся система не принимает."
      >
        {canAct && programOptions.length > 0 && (
          <Card>
            <form className={styles.form} onSubmit={onSubmitApplication}>
              <Select
                label="Программа"
                required
                options={programOptions}
                placeholder="Выберите программу"
                value={applicationProgramId}
                onValueChange={(value) => setApplicationProgramId(value)}
                error={errorFor(submitApplication.error, 'programId')}
              />
              <Input
                label="Количество заявок"
                required
                type="number"
                min={1}
                max={10000}
                step={1}
                inputMode="numeric"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                error={errorFor(submitApplication.error, 'quantity')}
                hint="От 1 до 10 000 в одной записи"
              />
              <Textarea
                label="Комментарий"
                rows={2}
                maxLength={1000}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                error={errorFor(submitApplication.error, 'comment')}
                hint="Необязательно: например, «Заявки весеннего набора»"
              />
              <div className={styles.formActions}>
                <Button type="submit" icon="plus" isLoading={submitApplication.isPending}>
                  Подать заявку
                </Button>
              </div>
            </form>
          </Card>
        )}

        <Card padding="none">
          {applications.isLoading ? (
            <TableSkeleton rows={3} columns={4} />
          ) : applications.error ? (
            <ErrorState error={applications.error} onRetry={applications.reload} />
          ) : applications.data && applications.data.length > 0 ? (
            <>
              <DataTable
                rows={applications.data}
                columns={applicationColumns}
                getRowKey={(row) => row.id}
                isRefreshing={applications.isRefreshing}
                caption="Заявки вуза на обучение"
              />
              {applications.meta && (
                <Pagination
                  page={applications.meta.page}
                  pageSize={applications.meta.pageSize}
                  total={applications.meta.total}
                  onPageChange={setPage}
                  nouns={['заявка', 'заявки', 'заявок']}
                />
              )}
            </>
          ) : (
            <EmptyState
              icon="program"
              title="Заявок нет"
              description="Ни одной заявки на обучение вуз пока не подавал."
            />
          )}
        </Card>
      </Section>

      <Modal
        isOpen={metricsProgram !== null}
        onClose={() => setMetricsProgram(null)}
        title="Показатели программы"
        description={metricsProgram?.name}
      >
        <form className={styles.form} onSubmit={onSaveMetrics} id="metrics-form">
          <Input
            label="Обучающихся"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={studentCount}
            onChange={(event) => setStudentCount(event.target.value)}
            error={errorFor(saveMetrics.error, 'studentCount')}
            hint="Пустое поле — «Нет данных»: значение будет стёрто, а не обнулено"
          />
          <Input
            label="Групп"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={groupCount}
            onChange={(event) => setGroupCount(event.target.value)}
            error={errorFor(saveMetrics.error, 'groupCount')}
            hint="Сколько параллельных групп учится по программе"
          />
          <p className={styles.cellMeta}>
            Количество заявок через кабинет не меняется: оно считается по поданным заявкам.
          </p>
          <div className={styles.formActions}>
            <Button variant="ghost" type="button" onClick={() => setMetricsProgram(null)}>
              Отмена
            </Button>
            <Button type="submit" icon="check" isLoading={saveMetrics.isPending}>
              Сохранить
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
