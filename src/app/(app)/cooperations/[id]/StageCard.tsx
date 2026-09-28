'use client'

import { useEffect, useRef, useState } from 'react'
import {
  CONFIRMATION_NOTE_MAX,
  CONFIRMATION_NOTE_MIN,
  REVIEWER_ACTIONS_NOTE,
  REVIEWER_CHECKLIST_NOTE,
  STAFF_ACTIONS_READ_ONLY_NOTE,
  STAFF_CHECKLIST_READ_ONLY_NOTE,
  STAGE_PHASE_LABELS,
  STAGE_STATUS_LABELS,
  type CooperationDto,
  type DocumentListItemDto,
  type StageHistoryEntryDto,
  type WorkflowStageDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  DeadlineBadge,
  Drawer,
  ErrorState,
  HelpHint,
  Icon,
  Checkbox,
  Modal,
  NAV_TRANSITION_ATTRIBUTE,
  SkeletonLines,
  StageStatusBadge,
  Textarea,
  apiGet,
  apiPatch,
  ApiRequestError,
  formatDate,
  formatDateTime,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
} from '@/ui'
import { Attachments } from '../../Attachments'
import { ChangeResponsibleModal } from '../../ChangeResponsibleModal'
import { StageActionModal, type StageActionKind } from '../../StageActionModal'
import { StageDeadlineModal } from '../../StageDeadlineModal'
import styles from './cooperation.module.css'

export interface StageCardProps {
  stage: WorkflowStageDto
  canWrite: boolean
  /** Этап, на который вела ссылка из уведомления: раскрыт и подсвечен. */
  isHighlighted: boolean
  onStageChanged: (stage: WorkflowStageDto) => void
  /**
   * Подписанные документы связки — у этапа «Подписание документов» (решение 87):
   * подпись видна рядом с чек-листом, даже если пункты ещё не отмечены.
   */
  signedDocuments?: DocumentListItemDto[]
}

/**
 * Один этап связки.
 *
 * Здесь живёт главное в системе: отказ. Сервер не даёт начать этап-контрольную
 * точку, пока не закрыты предыдущие, и не даёт закрыть этап с незакрытым
 * обязательным пунктом чек-листа. Его объяснение выводится в карточке целиком —
 * подменять его своим текстом нельзя, иначе пользователь не поймёт, что делать.
 */
export function StageCard({ stage, canWrite, isHighlighted, onStageChanged, signedDocuments }: StageCardProps) {
  const toast = useToast()
  const user = useCurrentUser()
  const [isOpen, setIsOpen] = useState(isHighlighted)
  // Окна действий со сменой статуса — общие с главной (StageActionModal, решение 206).
  const [action, setAction] = useState<StageActionKind | null>(null)
  const [refusal, setRefusal] = useState<ApiRequestError | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  // Срок и ответственный этапа (пробел ТЗ, решение 153) — своими окнами, а не
  // окном смены статуса (StageActionModal): это правка полей без смены статуса, у неё нет комментария.
  const [isDeadlineOpen, setIsDeadlineOpen] = useState(false)
  const [isResponsibleOpen, setIsResponsibleOpen] = useState(false)
  // Пункт вуза без представителя отмечается с пометкой «чем подтверждено» (решение 103).
  const [noteTaskId, setNoteTaskId] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const cardRef = useRef<HTMLDivElement | null>(null)

  // Ссылка из уведомления ведёт к конкретному этапу — прокручиваем к нему.
  useEffect(() => {
    if (isHighlighted) {
      setIsOpen(true)
      // Явное 'smooth' перебивает CSS, где прокрутка при «уменьшить движение»
      // выключена (globals.css), — поэтому настройку системы читаем здесь.
      // Во время перехода со строки (layout/navigation-motion) — сразу: плашка
      // раскрывается прямо в этап, а плавная прокрутка поехала бы внутри неё.
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const instant = reduceMotion || document.documentElement.hasAttribute(NAV_TRANSITION_ATTRIBUTE)
      cardRef.current?.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'center' })
    }
  }, [isHighlighted])

  const updateStage = useMutation(async (body: Record<string, unknown>) => {
    const result = await apiPatch<WorkflowStageDto>(`/api/workflow/stages/${stage.id}`, body)
    return result.data
  })

  const toggleTask = useMutation(
    async (input: { taskId: string; isDone: boolean; confirmationNote?: string }) => {
      const result = await apiPatch<WorkflowStageDto>(`/api/workflow/tasks/${input.taskId}`, {
        isDone: input.isDone,
        ...(input.confirmationNote ? { confirmationNote: input.confirmationNote } : {}),
      })
      return result.data
    },
  )

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

  /**
   * Окно действия показывает отказ только своей отправки: у окна своя мутация,
   * а прежний отказ карточки («Начать этап») при открытии окна сбрасывается.
   */
  function openAction(kind: StageActionKind) {
    updateStage.reset()
    setRefusal(null)
    setAction(kind)
  }

  async function onToggleTask(taskId: string, isDone: boolean, confirmationNote?: string) {
    setRefusal(null)
    // Отметку за вуз без пометки сервер не примет — сначала спрашиваем, чем подтверждено.
    const task = stage.tasks.find((item) => item.id === taskId)
    if (isDone && task?.staffMarkRule === 'NOTE_REQUIRED' && confirmationNote === undefined) {
      toggleTask.reset()
      setNoteText('')
      setNoteTaskId(taskId)
      return false
    }
    const result = await toggleTask.run({ taskId, isDone, confirmationNote })
    if (!result.ok) {
      setRefusal(result.error)
      toast.error(result.error.message)
      return false
    }
    onStageChanged(result.data)
    return true
  }

  function closeNote() {
    toggleTask.reset()
    setNoteTaskId(null)
    setNoteText('')
  }

  async function onSubmitNote() {
    if (noteTaskId === null) return
    const ok = await onToggleTask(noteTaskId, true, noteText.trim())
    if (ok) closeNote()
  }

  /**
   * `ChangeResponsibleModal` (решение 151) сам не отдаёт обновлённый этап — только
   * признак «сохранено». `onStageChanged` выше по контракту ждёт настоящий свежий
   * `WorkflowStageDto` (см. `patchedStages` в карточке связки: без него правка
   * зависла бы в состоянии до перезагрузки). Свежую запись этапа берём тем же
   * маршрутом, что и перезагрузка связки на странице, — отдельного GET на один
   * этап в API нет и заводить его ради одной кнопки незачем.
   */
  async function onResponsibleChanged(changed: boolean) {
    setIsResponsibleOpen(false)
    if (!changed) return
    try {
      const result = await apiGet<CooperationDto>(`/api/cooperations/${stage.cooperationId}`)
      const fresh = result.data.stages.find((item) => item.id === stage.id)
      if (fresh) onStageChanged(fresh)
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Не удалось обновить этап')
    }
  }

  const isDone = stage.status === 'COMPLETED'
  const isCancelled = stage.status === 'CANCELLED'
  const isStageOpen = !isDone && !isCancelled
  const numberClass = [
    styles.stageNumber,
    isDone ? styles.stageNumberDone : '',
    stage.isOverdue ? styles.stageNumberOverdue : '',
    stage.status === 'IN_PROGRESS' ? styles.stageNumberCurrent : '',
  ]
    .filter(Boolean)
    .join(' ')

  const requiredLeft = stage.requiredTasksTotal - stage.requiredTasksDone

  // Без права записи флажки неактивны, кнопок этапа нет — и это объясняется словами
  // (решение 232): молча неактивный флажок на контрольной точке выглядел как ошибка.
  // Эксперту — ещё и где увидеть отказ системы вживую.
  const checklistReadOnly = canWrite
    ? undefined
    : user.isReviewer
      ? REVIEWER_CHECKLIST_NOTE
      : STAFF_CHECKLIST_READ_ONLY_NOTE
  const actionsReadOnly = canWrite ? undefined : user.isReviewer ? REVIEWER_ACTIONS_NOTE : STAFF_ACTIONS_READ_ONLY_NOTE

  return (
    // Строка ленты этапов, а не отдельная карточка: четырнадцать одинаковых
    // скруглённых прямоугольников подряд — тот самый шаблон, от которого уходим (07, раздел 40).
    <div className={isHighlighted ? `${styles.stageRow} ${styles.stageRowSelected}` : styles.stageRow}>
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
              {/* У открытого этапа срок и ответственный — на виду: просрочка красным,
                  близкий срок жёлтым, «не назначен» — жёлтым (ТЗ дизайна 26–29.09, п. 3.3).
                  У закрытого — прежней тихой подписью: там это уже история. */}
              {stage.deadline && (
                <span
                  className={
                    isStageOpen && stage.isOverdue
                      ? styles.metaOverdue
                      : isStageOpen && stage.isDueSoon
                        ? styles.metaDueSoon
                        : undefined
                  }
                >
                  срок {formatDate(stage.deadline)}
                </span>
              )}
              {stage.responsible ? (
                <span className={isStageOpen ? styles.metaResponsible : undefined}>
                  {stage.responsible.fullName}
                </span>
              ) : (
                isStageOpen && <span className={styles.metaDueSoon}>ответственный не назначен</span>
              )}
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
              isPlanShifted={stage.isPlanShifted}
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
                <span className={[styles.blockLabel, styles.blockLabelHelp].join(' ')}>
                  <span>
                    Чек-лист этапа
                    {requiredLeft > 0 && ` · не закрыто обязательных: ${requiredLeft}`}
                  </span>
                  <HelpHint topic="stages" section="checklist" readOnly={checklistReadOnly} />
                </span>
                {checklistReadOnly && (
                  <p className={styles.readOnlyNote} id={`checklist-read-only-${stage.id}`}>
                    <Icon name="lock" size={16} />
                    <span>{checklistReadOnly}</span>
                  </p>
                )}
                <div
                  className={styles.tasks}
                  aria-describedby={checklistReadOnly ? `checklist-read-only-${stage.id}` : undefined}
                >
                  {stage.tasks.map((task) => (
                    <div
                      key={task.id}
                      className={[styles.task, task.isDone ? styles.taskDone : ''].filter(Boolean).join(' ')}
                    >
                      <Checkbox
                        label={
                          <span className={styles.taskText}>
                            <span className={styles.taskTitle}>{task.title}</span>
                            {/* Бирка — своей строкой с постоянным отступом, а не после текста
                                (решение 140, п. 3): раньше положение зависело от того, влез ли
                                текст на первую строку, и «обязательный» стоял то рядом, то ниже. */}
                            {task.isRequired && (
                              <Badge tone="accent" title="Без этой задачи этап нельзя завершить.">
                                обязательный
                              </Badge>
                            )}
                          </span>
                        }
                        checked={task.isDone}
                        disabled={
                          !canWrite ||
                          isCancelled ||
                          toggleTask.isPending ||
                          task.staffMarkRule === 'UNIVERSITY_ONLY'
                        }
                        onChange={(event) => onToggleTask(task.id, event.target.checked)}
                      />
                      {task.isDone && task.doneBy && (
                        <span className={styles.taskMeta}>
                          {task.doneBy.fullName}
                          {task.doneAt && `, ${formatDate(task.doneAt)}`}
                          {task.confirmationNote && ` · ${task.confirmationNote}`}
                        </span>
                      )}
                      {canWrite && task.staffMarkRule === 'UNIVERSITY_ONLY' && (
                        <span className={styles.taskMeta}>
                          Отмечает представитель вуза в кабинете вуза
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {signedDocuments && signedDocuments.length > 0 && (
                  <span className={styles.taskMeta}>
                    Подписано по документам:{' '}
                    {signedDocuments
                      .map((document) =>
                        `«${document.title}»${document.signedAt ? `, ${formatDate(document.signedAt)}` : ''}`,
                      )
                      .join('; ')}
                  </span>
                )}
              </div>
            )}

            <div className={styles.block}>
              <span className={[styles.blockLabel, styles.blockLabelHelp].join(' ')}>
                Файлы
                <HelpHint topic="stages" section="files" />
              </span>
              <Attachments ownerType="STAGE" ownerId={stage.id} canWrite={canWrite} />
            </div>

            <div className={styles.actions}>
              {stage.isAutoManaged ? (
                <span className={styles.auto}>
                  <Icon name="lock" size={16} />
                  Этап вычисляется системой: он закроется сам, когда закроются остальные.
                </span>
              ) : canWrite ? (
                <>
                  {stage.status === 'NOT_STARTED' && (
                    <Button
                      variant="primary"
                      size="sm"
                      icon="play"
                      onClick={onStart}
                      isLoading={updateStage.isPending}
                    >
                      Начать этап
                    </Button>
                  )}
                  {stage.status === 'BLOCKED' && (
                    <Button variant="primary" size="sm" icon="play" onClick={() => openAction('unblock')}>
                      Снять блокировку
                    </Button>
                  )}
                  {stage.status === 'IN_PROGRESS' && (
                    <>
                      <Button variant="primary" size="sm" icon="check" onClick={() => openAction('complete')}>
                        Завершить
                      </Button>
                      <Button variant="secondary" size="sm" icon="pause" onClick={() => openAction('block')}>
                        Заблокировать
                      </Button>
                    </>
                  )}
                  {isDone && (
                    <Button variant="secondary" size="sm" icon="refresh" onClick={() => openAction('reopen')}>
                      Переоткрыть
                    </Button>
                  )}
                  {(stage.status === 'NOT_STARTED' ||
                    stage.status === 'IN_PROGRESS' ||
                    stage.status === 'BLOCKED') && (
                    <Button variant="ghost" size="sm" icon="block" onClick={() => openAction('cancel')}>
                      Отменить
                    </Button>
                  )}
                  {/*
                    Срок и ответственный — правка полей без смены статуса (решение 153),
                    поэтому доступны в любом статусе этапа, а не только «в работе».
                  */}
                  <Button variant="ghost" size="sm" icon="calendar" onClick={() => setIsDeadlineOpen(true)}>
                    Изменить срок
                  </Button>
                  <Button variant="ghost" size="sm" icon="user" onClick={() => setIsResponsibleOpen(true)}>
                    Сменить ответственного
                  </Button>
                </>
              ) : null}

              <Button variant="ghost" size="sm" icon="clock" onClick={() => setIsHistoryOpen(true)}>
                История
              </Button>
              <HelpHint topic="stages" section="actions" readOnly={actionsReadOnly} />
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
        <StageActionModal
          stage={{ id: stage.id, stageNumber: stage.stageNumber }}
          kind={action}
          onRefused={setRefusal}
          onClose={(updated) => {
            setAction(null)
            if (updated) {
              setRefusal(null)
              onStageChanged(updated)
              setIsOpen(true)
            }
          }}
        />
      )}

      {noteTaskId !== null && (
        <Modal
          isOpen
          onClose={closeNote}
          title="Подтверждение вуза"
          help={{ topic: 'stages', section: 'uni-confirm' }}
          description="У вуза нет представителя в системе, поэтому пункт отмечает сотрудник. Укажите, чем вуз подтвердил получение материалов."
          closeOnBackdrop={false}
          footer={
            <>
              <Button variant="ghost" onClick={closeNote}>
                Отмена
              </Button>
              <Button
                variant="primary"
                onClick={onSubmitNote}
                isLoading={toggleTask.isPending}
                disabled={noteText.trim().length < CONFIRMATION_NOTE_MIN}
              >
                Отметить
              </Button>
            </>
          }
        >
          <Textarea
            label="Чем подтверждено"
            hint={`Например, «письмо от 12.09». От ${CONFIRMATION_NOTE_MIN} до ${CONFIRMATION_NOTE_MAX} символов.`}
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            maxLength={CONFIRMATION_NOTE_MAX}
            autoFocus
          />
          {toggleTask.error && (
            <p className={styles.refusal} role="alert">
              <Icon name="alert" size={20} />
              <span>
                <span className={styles.refusalTitle}>Система не разрешает это действие</span>
                {toggleTask.error.message}
              </span>
            </p>
          )}
        </Modal>
      )}

      {isHistoryOpen && (
        <StageHistoryDrawer stageId={stage.id} stageTitle={stage.title} onClose={() => setIsHistoryOpen(false)} />
      )}

      {isDeadlineOpen && (
        <StageDeadlineModal
          stage={stage}
          onClose={(updated) => {
            setIsDeadlineOpen(false)
            if (updated) onStageChanged(updated)
          }}
        />
      )}

      {isResponsibleOpen && (
        <ChangeResponsibleModal
          title={`Ответственный этапа ${stage.stageNumber}`}
          help={{ topic: 'stages', section: 'responsible' }}
          description={`«${stage.title}»`}
          endpoint={`/api/workflow/stages/${stage.id}`}
          consequence="Новый ответственный увидит назначение в уведомлениях и получит сообщение в подключённый мессенджер, смена попадёт в журнал действий — с автором и временем."
          currentResponsibleId={stage.responsible?.id ?? null}
          currentResponsibleName={stage.responsible?.fullName ?? null}
          allowNone
          onClose={onResponsibleChanged}
        />
      )}
    </div>
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
    <Drawer
      isOpen
      onClose={onClose}
      title="История этапа"
      description={stageTitle}
      help={{ topic: 'stages', section: 'history' }}
    >
      {history.isLoading ? (
        <SkeletonLines count={4} />
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
