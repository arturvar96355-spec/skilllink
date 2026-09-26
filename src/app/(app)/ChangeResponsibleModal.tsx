'use client'

import { useState } from 'react'
import { RESPONSIBLE_ROLES, USER_ROLE_LABELS, canBeResponsible, type UserDto } from '@/shared/contracts'
import { Button, Modal, Select, apiPatch, fieldErrors, useMutation, useResource, useToast } from '@/ui'
import styles from './ChangeResponsibleModal.module.css'

/**
 * Смена ответственного за вуз или за связку (ТЗ, роль «Руководитель», решение 146).
 *
 * Один и тот же выбор сотрудника для обоих мест: `PATCH /api/universities/:id/responsible`
 * и `PATCH /api/cooperations/:id` (поле `responsibleId`) — сервер и там, и там требует
 * право `ASSIGN_RESPONSIBLE`, кнопка вызывающей стороны уже проверила его сама
 * (`user.permissions.canAssignResponsible`), это окно от него не зависит.
 *
 * У вуза ответственный необязателен — можно снять (`allowNone`, отправляет `null`).
 * У связки он обязателен: сервер не примет пустое значение, поэтому кнопка
 * сохранения заблокирована, пока сотрудник не выбран.
 */
export interface ChangeResponsibleModalProps {
  title: string
  description?: string
  endpoint: string
  currentResponsibleId: string | null
  /** ФИО текущего ответственного — показать выбранным, пока список сотрудников грузится. */
  currentResponsibleName?: string | null
  allowNone?: boolean
  /**
   * Что произойдёт после сохранения — словами, по тому, что на самом деле делает
   * сервер (журнал, уведомление, история этапа). ТЗ дизайна 26–29.09, п. 2.4:
   * «кто сейчас → кого можно назначить → что произойдёт».
   */
  consequence?: string
  onClose: (changed: boolean) => void
}

/** «менеджера партнёрств, руководителя или администратора» — из тех же RESPONSIBLE_ROLES, что проверяет сервер. */
const ASSIGNABLE_TEXT = (() => {
  const names = RESPONSIBLE_ROLES.map((role) => USER_ROLE_LABELS[role].toLowerCase())
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} или ${names[names.length - 1]}` : (names[0] ?? '')
})()

export function ChangeResponsibleModal({
  title,
  description,
  endpoint,
  currentResponsibleId,
  currentResponsibleName,
  allowNone = false,
  consequence,
  onClose,
}: ChangeResponsibleModalProps) {
  const toast = useToast()
  const [responsibleId, setResponsibleId] = useState(currentResponsibleId ?? '')

  const users = useResource<UserDto[]>('/api/users?pageSize=100')

  const submit = useMutation(async (body: { responsibleId: string | null }) => {
    const result = await apiPatch(endpoint, body)
    return result.data
  })

  const errors = fieldErrors(submit.error)
  const errorFor = (field: string) => errors.find((item) => item.field === field)?.message ?? null

  async function onSave() {
    const result = await submit.run({ responsibleId: responsibleId === '' ? null : responsibleId })
    if (!result.ok) {
      if (result.error.code !== 'VALIDATION_ERROR') toast.error(result.error.message)
      return
    }
    const chosen = users.data?.find((row) => row.id === responsibleId)?.fullName
    toast.success(
      responsibleId === '' ? 'Ответственный снят' : chosen ? `Ответственный — ${chosen}` : 'Ответственный назначен',
    )
    onClose(true)
  }

  const options = (users.data ?? [])
    // Сервер примет только ADMIN, MANAGER или HEAD (RESPONSIBLE_ROLES).
    .filter((row) => canBeResponsible(row.role))
    .map((row) => ({ value: row.id, label: `${row.fullName} — ${USER_ROLE_LABELS[row.role]}` }))

  return (
    <Modal
      isOpen
      onClose={() => onClose(false)}
      title={title}
      description={description}
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={onSave}
            isLoading={submit.isPending}
            disabled={(!allowNone && responsibleId === '') || responsibleId === (currentResponsibleId ?? '')}
          >
            Сохранить
          </Button>
        </>
      }
    >
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Сейчас</dt>
          <dd className={styles.factValue}>{currentResponsibleName ?? 'Не назначен'}</dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Можно назначить</dt>
          <dd className={styles.factValue}>{ASSIGNABLE_TEXT}</dd>
        </div>
      </dl>

      <Select
        label="Новый ответственный"
        required={!allowNone}
        value={responsibleId}
        onValueChange={setResponsibleId}
        placeholder={users.isLoading ? 'Загрузка…' : allowNone ? 'Без ответственного' : 'Выберите сотрудника'}
        valueLabel={currentResponsibleName ?? undefined}
        options={options}
        error={errorFor('responsibleId')}
      />

      {consequence && <p className={styles.consequence}>{consequence}</p>}
    </Modal>
  )
}
