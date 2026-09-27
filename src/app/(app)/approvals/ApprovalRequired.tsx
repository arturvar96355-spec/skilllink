'use client'

import Link from 'next/link'
import { useState } from 'react'
import { APPROVAL_ACTION_LABELS, type ApprovalAction, type ApprovalDto } from '@/shared/contracts'
import {
  Button,
  Icon,
  Textarea,
  apiPatch,
  apiPost,
  approvalHref,
  formatDateTime,
  formatPersonShort,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
  notifyApprovalsChanged,
} from '@/ui'
import { executionBody, executionDoneText, findOwnRequest } from './approvals-view'
import styles from './approvals.module.css'

/**
 * «Нужно второе подтверждение» (решение 218) — вместо сухого 403 в окне пользователя.
 *
 * Сервер сам запрос не создаёт (решение 133): он отвечает 403 с признаком
 * `approvalRequired`, и здесь человек в один шаг отправляет запрос второму
 * администратору. Если свой запрос на ту же операцию уже есть — не плодим дубль:
 * ждущий показываем ссылкой, согласованный — кнопкой «Выполнить».
 */
export function ApprovalRequired({
  action,
  userId,
  userName,
  onDone,
}: {
  action: ApprovalAction
  userId: string
  userName: string
  /** Операция выполнена по согласованию — окно закрывается, список перечитывается. */
  onDone: () => void
}) {
  const me = useCurrentUser()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [sent, setSent] = useState<ApprovalDto | null>(null)
  // Свои запросы — чтобы найти уже отправленный на ту же операцию.
  const own = useResource<ApprovalDto[]>('/api/admin/approvals?scope=mine&pageSize=100')

  const send = useMutation(async () => {
    const result = await apiPost<ApprovalDto>('/api/admin/approvals', {
      action,
      payload: { userId },
      reason: reason.trim(),
    })
    return result.data
  })
  const run = useMutation(async (approval: ApprovalDto) => {
    await apiPatch(`/api/users/${userId}`, executionBody(approval.action, approval.id))
    return approval
  })

  const existing = sent ?? (own.data ? findOwnRequest(own.data, action, userId, me.id, Date.now()) : null)

  async function submit() {
    const result = await send.run(undefined)
    if (result.ok) setSent(result.data)
  }

  async function execute(approval: ApprovalDto) {
    const result = await run.run(approval)
    if (!result.ok) return
    toast.success(executionDoneText(approval))
    notifyApprovalsChanged()
    onDone()
  }

  let body
  if (existing?.status === 'APPROVED') {
    body = (
      <>
        <p className={styles.panelTitle}>Запрос уже согласован</p>
        <p className={styles.panelText}>
          «{APPROVAL_ACTION_LABELS[action]}» для {userName} согласовано
          {existing.approvedBy ? ` (${formatPersonShort(existing.approvedBy.fullName)})` : ''}. Выполните — согласование
          сработает один раз, до {formatDateTime(existing.expiresAt)}.
        </p>
        <div className={styles.actions}>
          <Button variant="primary" size="sm" icon="check" onClick={() => execute(existing)} isLoading={run.isPending}>
            Выполнить
          </Button>
        </div>
        {run.error && <p className={styles.refusal}>{run.error.message}</p>}
      </>
    )
  } else if (existing) {
    body = (
      <>
        <p className={styles.panelTitle}>{sent ? 'Запрос отправлен' : 'Запрос уже отправлен'}</p>
        <p className={styles.panelText}>
          Другие администраторы видят его в «Согласованиях» и в колокольчике. Когда согласуют, в «Согласованиях»
          появится кнопка «Выполнить» — операция пройдёт один раз. Срок — до {formatDateTime(existing.expiresAt)}.
        </p>
        <Link className={styles.link} href={approvalHref(existing.id)}>
          Открыть запрос
          <Icon name="arrowRight" size={16} />
        </Link>
      </>
    )
  } else {
    body = (
      <>
        <p className={styles.panelTitle}>Нужно второе подтверждение</p>
        <p className={styles.panelText}>
          «{APPROVAL_ACTION_LABELS[action]}» делают вдвоём: вы отправляете запрос, другой администратор согласует, затем
          вы выполняете. Так одна ошибка или чужой вход под вашей учётной записью не дают полного доступа.
        </p>
        <Textarea
          label="Зачем это нужно"
          hint="Увидит тот, кто будет согласовывать. Можно не заполнять"
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={own.isLoading}
        />
        <div className={styles.actions}>
          <Button variant="primary" size="sm" icon="lock" onClick={submit} isLoading={send.isPending} disabled={own.isLoading}>
            Отправить на согласование
          </Button>
        </div>
        {send.error && <p className={styles.refusal}>{send.error.message}</p>}
      </>
    )
  }

  return (
    <div className={styles.panel} role="status">
      <Icon name="lock" size={16} />
      <div className={styles.panelBody}>{body}</div>
    </div>
  )
}
