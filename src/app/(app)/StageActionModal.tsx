'use client'

import { useState } from 'react'
import { STAGE_STATUS_LABELS, type StageStatus, type WorkflowStageDto } from '@/shared/contracts'
import { ApiRequestError, Button, Icon, Modal, Textarea, apiPatch, useMutation, useToast } from '@/ui'
import styles from './StageActionModal.module.css'

/**
 * Смена статуса этапа с комментарием — одно окно на карточку связки и на главную
 * (решение 206: «Снять блокировку» прямо из блока «Требует внимания»).
 *
 * Раньше окно жило внутри `StageCard`, и главная не могла им воспользоваться,
 * не открывая карточку связки. Поведение то же: у каждого действия свой
 * комментарий, обязателен он везде, кроме снятия блокировки — там «что изменилось»
 * полезно, но не всегда известно.
 */
export type StageActionKind = 'complete' | 'block' | 'unblock' | 'cancel' | 'reopen'

export const STAGE_ACTION_FORMS: Record<
  StageActionKind,
  {
    title: string
    description: string
    label: string
    hint: string
    field: 'result' | 'comment' | 'blockingReason'
    status: StageStatus
    submit: string
    optional?: boolean
  }
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
  unblock: {
    title: 'Снять блокировку',
    description: 'Этап вернётся в работу. Причина блокировки останется в истории этапа.',
    label: 'Что изменилось',
    hint: 'Необязательно: например, «вуз подписал NDA». Текст попадёт в историю этапа.',
    field: 'comment',
    status: 'IN_PROGRESS',
    submit: 'Снять блокировку',
    optional: true,
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

/** Что окну нужно знать об этапе: у карточки это весь `WorkflowStageDto`, у главной — строка проблемы. */
export interface StageActionTarget {
  id: string
  stageNumber: number
  /** Название этапа — в описании окна, чтобы с главной было видно, какой этап меняется. */
  title?: string
}

export interface StageActionModalProps {
  stage: StageActionTarget
  kind: StageActionKind
  /** `updated` — свежий этап после сохранения; `null` — окно закрыли без изменений. */
  onClose: (updated: WorkflowStageDto | null) => void
  /** Отказ сервера — карточка связки показывает его ещё и у себя, крупно (решение 44). */
  onRefused?: (error: ApiRequestError) => void
}

export function StageActionModal({ stage, kind, onClose, onRefused }: StageActionModalProps) {
  const toast = useToast()
  const form = STAGE_ACTION_FORMS[kind]
  const [text, setText] = useState('')

  const update = useMutation(async (body: Record<string, unknown>) => {
    const result = await apiPatch<WorkflowStageDto>(`/api/workflow/stages/${stage.id}`, body)
    return result.data
  })

  async function submit() {
    const value = text.trim()
    // Пустое необязательное поле не отправляется: пустой комментарий стёр бы сохранённый.
    const result = await update.run({ status: form.status, ...(value ? { [form.field]: value } : {}) })
    if (!result.ok) {
      // Отказ — в окне и коротким сообщением: на защите экран смотрят издалека.
      toast.error(result.error.message)
      onRefused?.(result.error)
      return
    }
    toast.success(`Этап ${stage.stageNumber}: ${STAGE_STATUS_LABELS[form.status].toLowerCase()}`)
    onClose(result.data)
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(null)}
      title={form.title}
      help={{ topic: 'stages', section: 'actions' }}
      description={stage.title ? `Этап ${stage.stageNumber} «${stage.title}». ${form.description}` : form.description}
      // Закрытие щелчком по фону отключено: набранный текст жалко терять.
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(null)}>
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            isLoading={update.isPending}
            disabled={!form.optional && text.trim().length === 0}
          >
            {form.submit}
          </Button>
        </>
      }
    >
      <Textarea
        label={form.label}
        hint={form.hint}
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={2000}
        autoFocus
      />
      {update.error && (
        <p className={styles.refusal} role="alert">
          <Icon name="alert" size={20} />
          <span>
            <span className={styles.refusalTitle}>Система не разрешает это действие</span>
            {update.error.message}
          </span>
        </p>
      )}
    </Modal>
  )
}
