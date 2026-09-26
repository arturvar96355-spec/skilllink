'use client'

import { useState } from 'react'
import {
  COOPERATION_STATUSES,
  COOPERATION_STATUS_LABELS,
  type CooperationDto,
  type CooperationStatus,
} from '@/shared/contracts'
import { Button, Icon, Modal, Select, apiPatch, useMutation, useToast } from '@/ui'
import { cooperationStatusConsequence } from './cooperation-status'
import styles from './cooperation.module.css'

/**
 * Смена статуса связки (задача «Данные без экрана», пункт 1): `PATCH /api/cooperations/:id`
 * принимал поле `status` с самого начала, но менять его можно было только через
 * `/api-docs` или curl — в карточке статус только показывался значком.
 */
export function ChangeCooperationStatusModal({
  cooperation,
  onClose,
}: {
  cooperation: CooperationDto
  onClose: (updated: CooperationDto | null) => void
}) {
  const toast = useToast()
  const [status, setStatus] = useState<CooperationStatus>(cooperation.status)

  const save = useMutation(async (next: CooperationStatus) => {
    const result = await apiPatch<CooperationDto>(`/api/cooperations/${cooperation.id}`, { status: next })
    return result.data
  })

  async function submit() {
    if (status === cooperation.status) {
      onClose(null)
      return
    }
    const result = await save.run(status)
    if (!result.ok) {
      // Отказ (например, INVALID_TRANSITION или закрытая связка с другими правками)
      // показывается как есть — сервер уже объясняет причину по-русски.
      toast.error(result.error.message)
      return
    }
    toast.success(`Статус связки: «${COOPERATION_STATUS_LABELS[result.data.status]}»`)
    onClose(result.data)
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(null)}
      title="Сменить статус связки"
      description="Статус отражает состояние сотрудничества с вузом в целом — отдельно от того, на каком этапе сейчас работа."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(null)}>
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            isLoading={save.isPending}
            disabled={status === cooperation.status}
          >
            Сменить статус
          </Button>
        </>
      }
    >
      <Select
        label="Новый статус"
        value={status}
        onValueChange={(value) => setStatus(value as CooperationStatus)}
        options={COOPERATION_STATUSES.map((value) => ({ value, label: COOPERATION_STATUS_LABELS[value] }))}
      />

      {status !== cooperation.status && (
        <p className={styles.blockText}>{cooperationStatusConsequence(cooperation.status, status)}</p>
      )}

      {save.error && (
        <p className={styles.refusal} role="alert">
          <Icon name="alert" size={20} />
          <span>
            <span className={styles.refusalTitle}>Система не разрешает это действие</span>
            {save.error.message}
          </span>
        </p>
      )}
    </Modal>
  )
}
