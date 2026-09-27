'use client'

import { useState } from 'react'
import {
  DSAR_REQUEST_KINDS,
  DSAR_REQUEST_KIND_LABELS,
  DSAR_SUBJECT_TYPES,
  DSAR_SUBJECT_TYPE_LABELS,
  type DsarEraseResultDto,
  type DsarRequestDto,
  type DsarRequestKind,
  type DsarSubjectType,
  type UserDto,
} from '@/shared/contracts'
import {
  Button,
  Icon,
  Input,
  Modal,
  RemoteSelect,
  Select,
  apiPost,
  dateInputToIso,
  fieldErrors,
  useMutation,
} from '@/ui'
import { dsarConfirmHint } from './dsar-view'
import styles from './admin.module.css'

/**
 * Окна вкладки «Запросы субъектов» (решение 116, экраны — решение 181):
 * регистрация запроса, пришедшего письмом, и обезличивание по открытому запросу.
 */

function detailFor(error: unknown, field: string): string | null {
  return fieldErrors(error).find((item) => item.field === field)?.message ?? null
}

function generalError(error: unknown, fields: string[]): string | null {
  if (!error) return null
  if (fields.some((field) => detailFor(error, field))) return null
  return (error as { message?: string }).message ?? null
}

function Problem({ text }: { text: string }) {
  return (
    <div className={styles.danger} role="alert">
      <Icon name="alert" size={16} />
      <p>{text}</p>
    </div>
  )
}

const SUBJECT_OPTIONS = DSAR_SUBJECT_TYPES.map((value) => ({ value, label: DSAR_SUBJECT_TYPE_LABELS[value] }))
const KIND_OPTIONS = DSAR_REQUEST_KINDS.map((value) => ({ value, label: DSAR_REQUEST_KIND_LABELS[value] }))

// ─────────────────────────── Регистрация запроса (кто/что) ───────────────────────────

export function CreateDsarRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [subjectType, setSubjectType] = useState<DsarSubjectType>('USER')
  const [subjectId, setSubjectId] = useState('')
  const [kind, setKind] = useState<DsarRequestKind>('EXPORT')
  const [receivedAt, setReceivedAt] = useState('')

  const create = useMutation(async (body: Record<string, unknown>) => {
    const result = await apiPost<DsarRequestDto>('/api/admin/dsar/requests', body)
    return result.data
  })

  async function submit() {
    const result = await create.run({
      subjectType,
      subjectId: subjectId.trim(),
      kind,
      receivedAt: receivedAt === '' ? undefined : (dateInputToIso(receivedAt) ?? undefined),
    })
    if (!result.ok) return
    onCreated()
    onClose()
  }

  const error = create.error

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Зарегистрировать запрос субъекта"
      help={{ topic: 'dsar', section: 'register' }}
      description="Для запроса, который пришёл письмом: срок ответа считается от даты получения, а не от сегодняшнего дня."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={create.isPending} disabled={subjectId.trim() === ''}>
            Зарегистрировать
          </Button>
        </>
      }
    >
      <Select
        label="Кто"
        required
        value={subjectType}
        onValueChange={(value) => {
          setSubjectType(value as DsarSubjectType)
          setSubjectId('')
        }}
        options={SUBJECT_OPTIONS}
      />
      {subjectType === 'USER' ? (
        <RemoteSelect<UserDto>
          label="Пользователь"
          required
          endpoint="/api/users"
          params={{ includeInactive: 'true' }}
          toOption={(row) => ({ value: row.id, label: row.fullName })}
          searchPlaceholder="ФИО или почта"
          placeholder="Выберите пользователя"
          value={subjectId}
          onValueChange={setSubjectId}
          error={detailFor(error, 'subjectId')}
        />
      ) : (
        <Input
          label="Идентификатор контакта"
          required
          placeholder="Идентификатор из карточки вуза"
          hint="Своего поиска по контактам здесь нет: скопируйте идентификатор кнопкой «Скопировать id» рядом с контактом в карточке вуза."
          value={subjectId}
          onChange={(event) => setSubjectId(event.target.value)}
          error={detailFor(error, 'subjectId')}
        />
      )}
      <Select
        label="Что"
        required
        value={kind}
        onValueChange={(value) => setKind(value as DsarRequestKind)}
        options={KIND_OPTIONS}
      />
      <Input
        label="Дата получения письма"
        type="date"
        hint="Не в будущем и не раньше 30 дней назад. Пусто — сегодняшний день"
        value={receivedAt}
        onChange={(event) => setReceivedAt(event.target.value)}
        error={detailFor(error, 'receivedAt')}
      />
      {generalError(error, ['subjectType', 'subjectId', 'kind', 'receivedAt']) && (
        <Problem text={generalError(error, ['subjectType', 'subjectId', 'kind', 'receivedAt'])!} />
      )}
    </Modal>
  )
}

// ───────────────────────────────── Обезличивание ─────────────────────────────────

export function EraseSubjectModal({
  request,
  onClose,
  onErased,
}: {
  request: DsarRequestDto
  onClose: () => void
  onErased: () => void
}) {
  const [confirm, setConfirm] = useState('')

  const erase = useMutation(async () => {
    const endpoint =
      request.subjectType === 'USER'
        ? `/api/admin/dsar/users/${request.subjectId}/erase`
        : `/api/admin/dsar/contacts/${request.subjectId}/erase`
    const result = await apiPost<DsarEraseResultDto>(endpoint, { confirm: confirm.trim() })
    return result.data
  })

  async function submit() {
    const result = await erase.run(undefined)
    if (!result.ok) return
    onErased()
    onClose()
  }

  const error = erase.error

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnBackdrop={false}
      title="Обезличить по запросу субъекта"
      help={{ topic: 'dsar', section: 'fulfil' }}
      description="Необратимо: персональные данные будут стёрты, запись останется без ФИО, почты и телефона — ради связей и истории работы."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={submit}
            isLoading={erase.isPending}
            disabled={confirm.trim().length === 0}
          >
            Обезличить
          </Button>
        </>
      }
    >
      <Input
        label="Подтверждение"
        required
        placeholder={request.subjectType === 'USER' ? 'ivanova@example.ru' : 'Иванова Мария Сергеевна'}
        hint={dsarConfirmHint(request.subjectType)}
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        error={detailFor(error, 'confirm')}
      />
      {generalError(error, ['confirm']) && <Problem text={generalError(error, ['confirm'])!} />}
    </Modal>
  )
}
