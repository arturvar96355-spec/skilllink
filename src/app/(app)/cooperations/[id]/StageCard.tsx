'use client'

import { useEffect, useRef, useState } from 'react'
import {
  STAGE_PHASE_LABELS,
  STAGE_STATUS_LABELS,
  type StageHistoryEntryDto,
  type StageStatus,
  type WorkflowStageDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  DeadlineBadge,
  Drawer,
  ErrorState,
  Icon,
  Checkbox,
  Modal,
  StageStatusBadge,
  Textarea,
  apiPatch,
  formatDate,
  formatDateTime,
  useMutation,
  useResource,
  useToast,
  type ApiRequestError,
} from '@/ui'
import styles from './cooperation.module.css'

/** Действие над этапом: у каждого свой обязательный комментарий. */
type ActionKind = 'complete' | 'block' | 'cancel' | 'reopen'

const ACTION_FORMS: Record<
  ActionKind,
  { title: string; description: string; label: string; hint: string; field: 'result' | 'comment' | 'blockingReason'; status: StageStatus; submit: string }
> = {
  complete: {
    title: 'Завершить этап',
    description: 'Результат сохранится в истории: по нему потом видно, что именно было сделано.',
    label: 'Результат этапа',
    hint: 'Обязательное поле: этап без результата не закрывается.',
    field: 'result',
    status: 'COMPLETED',
    submit: 'Завершить',
  },
  block: {
    title: 'Заблокировать этап',
    description: 'Блокировка означает, что работа остановлена по внешней причине.',
    label: 'Причина блокировки',
    hint: 'Обязательное поле: без причины блокировать нельзя.',
    field: 'blockingReason',
    status: 'BLOCKED',
    submit: 'Заблокировать',
  },
  cancel: {
    title: 'Отменить этап',
    description: 'Отменённый этап считается закрытым и в прогресс не входит.',
    label: 'Основание отмены',
    hint: 'Обязательное поле: например, «не требуется для этой связки».',
    field: 'comment',
    status: 'CANCELLED',
    submit: 'Отменить этап',
  },
  reopen: {
    title: 'Переоткрыть этап',
    description: 'Этап вернётся в работу. Запись об этом останется в истории.',
    label: 'Причина переоткрытия',
    hint: 'Обязательное поле: нужно объяснить, почему закрытый этап открывают заново.',
    field: 'comment',
    status: 'IN_PROGRESS',
    submit: 'Переоткрыть',
  },
}

export interface StageCardProps {
  stage: WorkflowStageDto
  canWrite: boolean
  /** Этап, на который вела ссылка из уведомления: раскрыт и подсвечен. */
  isHighlighted: boolean
  onStageChanged: (stage: WorkflowStageDto) => void
}

/**
 * Один этап связки.
 *
 * Здесь живёт главное в системе: отказ. Сервер не даёт начать этап-контрольную
 * точку, пока не закрыты предыдущие, и не даёт закрыть этап с незакрытым
 * обязательным пунктом чек-листа. Его объяснение выводится в карточке целиком —
 * подменять его своим текстом нельзя, иначе пользователь не поймёт, что делать.
 */
export function StageCard({ stage, canWrite, isHighlighted, onStageChanged }: StageCardProps) {
  const toast = useToast()
  const [isOpen, setIsOpen] = useState(isHighlighted)
  const [action, setAction] = useState<ActionKind | null>(null)
  const [text, setText] = useState('')
  const [refusal, setRefusal] = useState<ApiRequestError | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)

  // Ссылка из уведомления ведёт к конкретному этапу — прокручиваем к нему.
  useEffect(() => {
    if (isHighlighted) {
      setIsOpen(true)
      // Явное 'smooth' перебивает CSS, где прокрутка при «уменьшить движение»
      // выключена (globals.css), — поэтому настройку системы читаем здесь.
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      cardRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
    }
  }, [isHighlighted])

  const updateStage = useMutation(async (body: Record<string, unknown>) => {
    const result = await apiPatch<WorkflowStageDto>(`/api/workflow/stages/${stage.id}`, body)
    return result.data
  })

  const toggleTask = useMutation(async (input: { taskId: string; isDone: boolean }) => {
    const result = await apiPatch<WorkflowStageDto>(`/api/workflow/tasks/${input.taskId}`, {
      isDone: input.isDone,
    })
    return result.data
  })

  async function apply(body: Record<string, unknown>) {
    setRefusal(null)
    const result = await updateStage.run(body)
    if (!result.ok) {
      // Отказ показываем и в карточке, и коротким сообщением: на защите экран
      // смотрят издалека, и всплывающее сообщение заметнее.
      setRefusal(result.error)
      toast.error(result.error.message)
      return false
    }
    onStageChanged(result.data)
    setIsOpen(true)
    return true
  }

  async function onStart() {
    const ok = await apply({ status: 'IN_PROGRESS' })
    if (ok) toast.success(`Этап ${stage.stageNumber} взят в работу`)
  }

  async function onSubmitAction() {
    if (action === null) return
    const form = ACTION_FORMS[action]
    const ok = await apply({ status: form.status, [form.field]: text.trim() })
    if (ok) {
      toast.success(`Этап ${stage.stageNumber}: ${STAGE_STATUS_LABELS[form.status].toLowerCase()}`)
      setAction(null)
      setText('')
    }
  }

  async function onToggleTask(taskId: string, isDone: boolean) {
    setRefusal(null)
    const result = await toggleTask.run({ taskId, isDone })
    if (!result.ok) {
      setRefusal(result.error)
      toast.error(result.error.message)
      return
    }
    onStageChanged(result.data)
  }

  const isDone = stage.status === 'COMPLETED'
  const isCancelled = stage.status === 'CANCELLED'
  const numberClass = [
    styles.stageNumber,
    isDone ? styles.stageNumberDone : '',
    stage.isOverdue ? styles.stageNumberOverdue : '',
    stage.status === 'IN_PROGRESS' ? styles.stageNumberCurrent : '',
  ]
    .filter(Boolean)
    .join(' ')

  const requiredLeft = stage.requiredTasksTotal - stage.requiredTasksDone

  return (
    <Card padding="md" isSelected={isHighlighted}>
      <div className={styles.stage} ref={cardRef}>
        <div
          className={styles.stageHead}
          onClick={() => setIsOpen((current) => !current)}
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setIsOpen((current) => !current)
            }
          }}
        >
          <span className={numberClass}>{stage.stageNumber}</span>
          <span className={styles.stageTitleBlock}>
            <span className={styles.stageTitle}>{stage.title}</span>
            <span className={styles.stageMeta}>
              <span>{STAGE_PHASE_LABELS[stage.phase]}</span>
              {stage.deadline && <span>срок {formatDate(stage.deadline)}</span>}
              {stage.responsible && <span>{stage.responsible.fullName}</span>}
              {stage.requiredTasksTotal > 0 && (
                <span>
                  чек-лист {stage.requiredTasksDone}/{stage.requiredTasksTotal}
                </span>
              )}
            </span>
          </span>
          <span className={styles.stageBadges}>
            <DeadlineBadge
              isOverdue={stage.isOverdue}
              isDueSoon={stage.isDueSoon}
              daysToDeadline={stage.daysToDeadline}
            />
            <StageStatusBadge status={stage.status} />
            <Icon
              name="chevronDown"
              size={18}
              className={[styles.chevron, isOpen ? styles.chevronOpen : ''].filter(Boolean).join(' ')}
            />
          </span>
        </div>

        {isOpen && (
          <div className={styles.stageBody}>
            {refusal && (
              <p className={styles.refusal} role="alert">
                <Icon name="alert" size={20} />
                <span>
                  <span className={styles.refusalTitle}>Система не разрешает это действие</span>
                  {refusal.message}
                </span>
              </p>
            )}

            {stage.blockingReason && (
              <div className={styles.block}>
                <span className={styles.blockLabel}>Причина блокировки</span>
                <span className={styles.blockText}>{stage.blockingReason}</span>
              </div>
            )}

            {stage.result && (
              <div className={styles.block}>
                <span className={styles.blockLabel}>Результат</span>
                <span className={styles.blockText}>{stage.result}</span>
              </div>
            )}

            {stage.comment && (
              <div className={styles.block}>
                <span className={styles.blockLabel}>Комментарий</span>
                <span className={styles.blockText}>{stage.comment}</span>
              </div>
            )}

            {stage.tasks.length > 0 && (
              <div className={styles.block}>
                <span className={styles.blockLabel}>
                  Чек-лист этапа
                  {requiredLeft > 0 && ` · не закрыто обязательных: ${requiredLeft}`}
                </span>
                <div className={styles.tasks}>
                  {stage.tasks.map((task) => (
                    <div
                      key={task.id}
                      className={[styles.task, task.isDone ? styles.taskDone : ''].filter(Boolean).join(' ')}
                    >
                      <Checkbox
                        label={
                          <span className={styles.taskText}>
                            {task.title}
                            {task.isRequired && (
                              <>
                                {' '}
                                <Badge tone="accent">обязательный</Badge>
                              </>
                            )}
                          </span>
                        }
                        checked={task.isDone}
                        disabled={!canWrite || isCancelled || toggleTask.isPending}
                        onChange={(event) => onToggleTask(task.id, event.target.checked)}
                      />
                      {task.isDone && task.doneBy && (
                        <span className={styles.taskMeta}>
                          {task.doneBy.fullName}
                          {task.doneAt && `, ${formatDate(task.doneAt)}`}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.actions}>
              {stage.isAutoManaged ? (
                <span className={styles.auto}>
                  <Icon name="lock" size={16} />
                  Этап вычисляется системой: он закроется сам, когда закроются остальные.
                </span>
              ) : canWrite ? (
                <>
                  {(stage.status === 'NOT_STARTED' || stage.status === 'BLOCKED') && (
                    <Button
                      variant="primary"
                      size="sm"
                      icon="play"
                      onClick={onStart}
                      isLoading={updateStage.isPending}
                    >
                      {stage.status === 'BLOCKED' ? 'Снять блокировку' : 'Начать этап'}
                    </Button>
                  )}
                  {stage.status === 'IN_PROGRESS' && (
                    <>
                      <Button variant="primary" size="sm" icon="check" onClick={() => setAction('complete')}>
                        Завершить
                      </Button>
                      <Button variant="secondary" size="sm" icon="pause" onClick={() => setAction('block')}>
                        Заблокировать
                      </Button>
                    </>
                  )}
                  {isDone && (
                    <Button variant="secondary" size="sm" icon="refresh" onClick={() => setAction('reopen')}>
                      Переоткрыть
                    </Button>
                  )}
                  {(stage.status === 'NOT_STARTED' ||
                    stage.status === 'IN_PROGRESS' ||
                    stage.status === 'BLOCKED') && (
                    <Button variant="ghost" size="sm" icon="block" onClick={() => setAction('cancel')}>
                      Отменить
                    </Button>
                  )}
                </>
              ) : null}

              <Button variant="ghost" size="sm" icon="clock" onClick={() => setIsHistoryOpen(true)}>
                История
              </Button>
            </div>

            {(stage.startedAt || stage.completedAt) && (
              <span className={styles.taskMeta}>
                {stage.startedAt && `Начат ${formatDateTime(stage.startedAt)}. `}
                {stage.completedAt &&
                  `Закрыт ${formatDateTime(stage.completedAt)}${stage.completedBy ? `, ${stage.completedBy.fullName}` : ''}.`}
              </span>
            )}
          </div>
        )}
      </div>

      {action !== null && (
        <Modal
          isOpen
          onClose={() => {
            setAction(null)
            setText('')
          }}
          title={ACTION_FORMS[action].title}
          description={ACTION_FORMS[action].description}
          // Закрытие щелчком по фону отключено: набранный текст жалко терять.
          closeOnBackdrop={false}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setAction(null)
                  setText('')
                }}
              >
                Отмена
              </Button>
              <Button
                variant="primary"
                onClick={onSubmitAction}
                isLoading={updateStage.isPending}
                disabled={text.trim().length === 0}
              >
                {ACTION_FORMS[action].submit}
              </Button>
            </>
          }
        >
          <Textarea
            label={ACTION_FORMS[action].label}
            hint={ACTION_FORMS[action].hint}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={2000}
            autoFocus
          />
          {updateStage.error && (
            <p className={styles.refusal} role="alert">
              <Icon name="alert" size={20} />
              <span>
                <span className={styles.refusalTitle}>Система не разрешает это действие</span>
                {updateStage.error.message}
              </span>
            </p>
          )}
        </Modal>
      )}

      {isHistoryOpen && (
        <StageHistoryDrawer stageId={stage.id} stageTitle={stage.title} onClose={() => setIsHistoryOpen(false)} />
      )}
    </Card>
  )
}

/** История смен статуса этапа: кто, когда и с каким комментарием. */
function StageHistoryDrawer({
  stageId,
  stageTitle,
  onClose,
}: {
  stageId: string
  stageTitle: string
  onClose: () => void
}) {
  const history = useResource<StageHistoryEntryDto[]>(`/api/workflow/stages/${stageId}/history`)

  return (
    <Drawer isOpen onClose={onClose} title="История этапа" description={stageTitle}>
      {history.isLoading ? (
        <p className={styles.historyMeta}>Загрузка…</p>
      ) : history.error ? (
        <ErrorState error={history.error} onRetry={history.reload} />
      ) : (history.data ?? []).length === 0 ? (
        <p className={styles.historyMeta}>Изменений ещё не было.</p>
      ) : (
        <div className={styles.history}>
          {(history.data ?? []).map((entry) => (
            <div key={entry.id} className={styles.historyItem}>
              <StageStatusBadge status={entry.toStatus} />
              <span className={styles.historyText}>
                <span className={styles.historyTitle}>
                  {entry.fromStatus
                    ? `${STAGE_STATUS_LABELS[entry.fromStatus]} → ${STAGE_STATUS_LABELS[entry.toStatus]}`
                    : STAGE_STATUS_LABELS[entry.toStatus]}
                </span>
                {entry.comment && <span className={styles.blockText}>{entry.comment}</span>}
                <span className={styles.historyMeta}>
                  {formatDateTime(entry.changedAt)} · {entry.changedBy.fullName}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  )
}
