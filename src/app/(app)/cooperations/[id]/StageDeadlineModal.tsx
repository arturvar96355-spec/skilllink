'use client'

import { useState } from 'react'
import type { WorkflowStageDto } from '@/shared/contracts'
import { Button, Input, Modal, apiPatch, dateInputToIso, fieldErrors, isoToDateInput, useMutation, useToast } from '@/ui'

/**
 * Срок этапа (пробел ТЗ, решение 153): `PATCH /api/workflow/stages/:id` уже принимает
 * `deadline` (`updateStageSchema`, `workflow.schema.ts`) — правка полей без смены статуса
 * не запрещена ни для одного статуса, кроме контрольного этапа 14 (он вычисляется
 * системой, кнопка в `StageCard` для него и не показывается). Бэкенд не менялся.
 *
 * Пустое поле отправляет `null` (`dateInputToIso('')`) — срок можно снять, схема
 * этапа допускает `deadline: null`.
 */
export function StageDeadlineModal({
  stage,
  onClose,
}: {
  stage: WorkflowStageDto
  onClose: (updated: WorkflowStageDto | null) => void
}) {
  const toast = useToast()
  const [value, setValue] = useState(() => isoToDateInput(stage.deadline))

  const save = useMutation(async () => {
    const result = await apiPatch<WorkflowStageDto>(`/api/workflow/stages/${stage.id}`, {
      deadline: dateInputToIso(value),
    })
    return result.data
  })

  const errors = fieldErrors(save.error)
  const errorFor = (field: string) => errors.find((item) => item.field === field)?.message ?? null

  async function submit() {
    const result = await save.run(undefined)
    if (!result.ok) {
      if (result.error.code !== 'VALIDATION_ERROR') toast.error(result.error.message)
      return
    }
    toast.success(value === '' ? 'Срок этапа снят' : 'Срок этапа изменён')
    onClose(result.data)
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(null)}
      title={`Срок этапа ${stage.stageNumber}`}
      description={`«${stage.title}». Пустое поле снимает срок — этап перестаёт считаться просроченным или сдвинутым по плану.`}
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(null)}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={save.isPending}>
            Сохранить
          </Button>
        </>
      }
    >
      <Input
        label="Срок"
        type="date"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        error={errorFor('deadline')}
      />
    </Modal>
  )
}
