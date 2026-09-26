'use client'

import { useState } from 'react'
import {
  AI_DRAFT_SOURCE_LABELS,
  AI_PROPOSAL_KIND_LABELS,
  aiStorySourceNote,
  BLOCKER_CODE_LABELS,
  MEETING_FORMAT_LABELS,
  type AiProposalAppliedDto,
  type AiProposalDto,
  type AiStoryDto,
  type CooperationBlockersDto,
  type MeetingProposalPayload,
  type TaskProposalPayload,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Modal,
  SkeletonLines,
  apiPost,
  formatDate,
  formatDateTime,
  useMutation,
  useResource,
  useToast,
} from '@/ui'
import styles from './CooperationAssistant.module.css'

/**
 * «История сотрудничества», «Что мешает» и «Предложить план» на карточке
 * связки (решение 138). Числа и факты считает сервер, модель — если
 * подключена — только формулирует текст; ответ с числом не из фактов
 * отбрасывается сервером ещё до того, как дойти сюда.
 */

/** «Что мешает» — без модели: список уже посчитанных правилами препятствий. */
export function CooperationBlockers({ cooperationId }: { cooperationId: string }) {
  const blockers = useResource<CooperationBlockersDto>(`/api/cooperations/${cooperationId}/blockers`)

  if (blockers.isLoading) return <SkeletonLines count={3} />
  if (blockers.error) return <ErrorState error={blockers.error} onRetry={blockers.reload} />
  const data = blockers.data
  if (!data) return null

  if (data.blockers.length === 0) {
    return (
      <EmptyState
        icon="check"
        title="Ничего не мешает"
        description="Правила не нашли препятствий для перехода к следующему этапу."
      />
    )
  }

  return (
    <ul className={styles.blockers}>
      {data.blockers.map((blocker, index) => (
        <li key={`${blocker.code}-${index}`} className={styles.blocker} data-main={index === 0 || undefined}>
          <span className={styles.blockerMark} aria-hidden="true">
            <Icon name="alert" size={16} />
          </span>
          <span className={styles.blockerText}>
            <span className={styles.blockerLabel}>
              {index === 0 && <span className="visually-hidden">Главное препятствие: </span>}
              {BLOCKER_CODE_LABELS[blocker.code]}
            </span>
            <span className={styles.blockerDetail}>{blocker.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * «История сотрудничества» — ничего не запрашивается при открытии карточки:
 * обращение к модели стоит денег и идёт в лимит пользователя, поэтому текст
 * составляется только по нажатию (та же логика, что у `AiAssistCard`).
 */
export function CooperationStory({ cooperationId }: { cooperationId: string }) {
  const [requested, setRequested] = useState(false)
  const story = useResource<AiStoryDto>(requested ? `/api/cooperations/${cooperationId}/story` : null)
  const byModel = story.data ? story.data.source !== 'template' : false

  return (
    <div className={styles.section}>
      <div className={styles.head}>
        <Button
          variant="secondary"
          icon="spark"
          onClick={() => (requested ? story.reload() : setRequested(true))}
          isLoading={story.isLoading}
        >
          {requested ? 'Составить заново' : 'Составить историю'}
        </Button>
      </div>

      {!requested && (
        <p className={styles.description}>
          Короткая сводка: сколько длится сотрудничество, что уже сделано и что сейчас мешает — вместо
          пересказа карточки вручную.
        </p>
      )}

      {requested && story.isLoading && <SkeletonLines count={4} />}
      {requested && story.error && <ErrorState error={story.error} onRetry={story.reload} />}

      {requested && story.data && (
        <>
          <div className={styles.source}>
            <Badge tone={byModel ? 'accent' : 'neutral'} withDot>
              {story.data.provider ? `ИИ · ${AI_DRAFT_SOURCE_LABELS[story.data.provider]}` : 'Шаблон'}
            </Badge>
            <span className={styles.note}>{aiStorySourceNote(story.data)}</span>
          </div>

          <p className={styles.text}>{story.data.text}</p>

          <span className={styles.note}>
            Данные на {formatDateTime(story.data.dataAsOf)}
            {story.data.model ? ` · ${story.data.model}` : ''}
          </span>

          {story.data.facts.length > 0 && (
            <details className={styles.facts}>
              <summary>
                {byModel ? 'Что ушло в модель' : 'Из каких фактов собран текст'} — {story.data.facts.length}
              </summary>
              <ul>
                {story.data.facts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  )
}

function ProposalPayloadView({ payload }: { payload: AiProposalDto['payload'] }) {
  if (payload.kind === 'meeting') {
    const meeting = payload as MeetingProposalPayload
    return (
      <div className={styles.proposalFacts}>
        <span className={styles.blockerLabel}>{meeting.topic}</span>
        <span className={styles.note}>
          {formatDateTime(meeting.date)} · {MEETING_FORMAT_LABELS[meeting.format]}
        </span>
        {meeting.agenda.length > 0 && (
          <ul className={styles.agenda}>
            {meeting.agenda.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }
  const task = payload as TaskProposalPayload
  return (
    <div className={styles.proposalFacts}>
      <span className={styles.blockerLabel}>
        Этап {task.stageNumber} «{task.stageTitle}»
      </span>
      <span className={styles.note}>
        {task.currentDeadline ? `Текущий срок: ${formatDate(task.currentDeadline)} → ` : ''}
        Новый срок: {formatDate(task.dueDate)}
      </span>
    </div>
  )
}

/**
 * «Предложить план» (решение 138): проект встречи или новой даты этапа.
 * Ничего не пишет в базу, пока не нажали «Сохранить» — тогда проект
 * применяет штатный сервис (встреч или этапов) с обычными проверками.
 * Право `WRITE`: кнопка видна только тем, кто может писать связку.
 */
export function CooperationProposalAction({
  cooperationId,
  onApplied,
}: {
  cooperationId: string
  onApplied: (result: AiProposalAppliedDto) => void
}) {
  const toast = useToast()
  const [proposal, setProposal] = useState<AiProposalDto | null>(null)

  const propose = useMutation(async () => (await apiPost<AiProposalDto>(`/api/cooperations/${cooperationId}/proposals`)).data)
  const apply = useMutation(
    async (proposalId: string) =>
      (await apiPost<AiProposalAppliedDto>(`/api/cooperations/${cooperationId}/proposals/${proposalId}/apply`)).data,
  )

  async function onPropose() {
    const result = await propose.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setProposal(result.data)
  }

  async function onApply() {
    if (!proposal) return
    const result = await apply.run(proposal.proposalId)
    if (!result.ok) {
      // 409 — данные связки изменились между постройкой проекта и сохранением
      // (или час истёк): сервер уже сказал словами, что случилось, просто
      // закрываем устаревший проект — новый строится нажатием кнопки заново.
      toast.error(result.error.message)
      setProposal(null)
      return
    }
    toast.success('План сохранён')
    setProposal(null)
    onApplied(result.data)
  }

  return (
    <>
      <Button variant="secondary" icon="calendar" onClick={onPropose} isLoading={propose.isPending}>
        Предложить план
      </Button>

      {proposal && (
        <Modal
          isOpen
          onClose={() => setProposal(null)}
          title={`Проект: ${AI_PROPOSAL_KIND_LABELS[proposal.kind]}`}
          description="Ничего ещё не сохранено — проверьте и подтвердите или отмените."
          closeOnBackdrop={false}
          footer={
            <>
              <Button variant="ghost" onClick={() => setProposal(null)}>
                Отменить
              </Button>
              <Button variant="primary" onClick={onApply} isLoading={apply.isPending}>
                Сохранить
              </Button>
            </>
          }
        >
          <div className={styles.proposal}>
            <ProposalPayloadView payload={proposal.payload} />
            {proposal.warnings.length > 0 && (
              <ul className={styles.warnings}>
                {proposal.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <span className={styles.expires}>Проект действует до {formatDateTime(proposal.expiresAt)}</span>
          </div>
        </Modal>
      )}
    </>
  )
}
