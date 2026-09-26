'use client'

import { useState } from 'react'
import {
  PROGRAM_LEVELS,
  PROGRAM_LEVEL_LABELS,
  PROGRAM_STATUSES,
  PROGRAM_STATUS_LABELS,
  type ProgramDto,
} from '@/shared/contracts'
import { Button, Input, Modal, Select, apiPatch, fieldErrors, useMutation, useToast } from '@/ui'

/**
 * Правка карточки программы (решение 152, пробел ТЗ РТК). Поля — те же, что
 * в `CreateProgramModal`, кроме вуза: программу к другому вузу не переносят.
 * Показатели набора (заявки, обучающиеся, группы) правятся не здесь — это
 * не часть этой формы ни в создании, ни здесь.
 */
export function EditProgramModal({
  program,
  onClose,
}: {
  program: ProgramDto
  onClose: (changed: boolean) => void
}) {
  const toast = useToast()

  const [name, setName] = useState(program.name)
  const [code, setCode] = useState(program.code ?? '')
  const [direction, setDirection] = useState(program.direction ?? '')
  const [level, setLevel] = useState<string>(program.level)
  const [durationMonths, setDurationMonths] = useState(
    program.durationMonths === null ? '' : String(program.durationMonths),
  )
  const [status, setStatus] = useState<string>(program.status)

  const update = useMutation(async (body: Record<string, unknown>) => {
    const result = await apiPatch<ProgramDto>(`/api/programs/${program.id}`, body)
    return result.data
  })

  const errors = fieldErrors(update.error)
  const errorFor = (field: string) => errors.find((item) => item.field === field)?.message ?? null

  async function submit() {
    const duration = durationMonths.trim() === '' ? null : Number(durationMonths)
    const result = await update.run({
      name: name.trim(),
      code: code.trim() === '' ? null : code.trim(),
      direction: direction.trim() === '' ? null : direction.trim(),
      level,
      durationMonths: duration,
      status,
    })

    if (!result.ok) {
      if (result.error.code !== 'VALIDATION_ERROR') toast.error(result.error.message)
      return
    }

    toast.success(`Программа «${result.data.name}» изменена`)
    onClose(true)
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(false)}
      title="Изменить программу"
      description="Вуз программы не меняется. Показатели набора правятся в самой карточке."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={update.isPending}>
            Сохранить
          </Button>
        </>
      }
    >
      <Input
        label="Название"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errorFor('name')}
        autoFocus
      />
      <Input
        label="Код направления"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        error={errorFor('code')}
        placeholder="09.03.04"
      />
      <Input
        label="Направление подготовки"
        value={direction}
        onChange={(event) => setDirection(event.target.value)}
        error={errorFor('direction')}
      />
      <Select
        label="Уровень"
        required
        value={level}
        onValueChange={setLevel}
        options={PROGRAM_LEVELS.map((value) => ({ value, label: PROGRAM_LEVEL_LABELS[value] }))}
        error={errorFor('level')}
      />
      <Input
        label="Длительность, месяцев"
        type="number"
        min={1}
        max={120}
        value={durationMonths}
        onChange={(event) => setDurationMonths(event.target.value)}
        error={errorFor('durationMonths')}
        hint="Не знаете — оставьте пустым: будет «Нет данных», а не ноль."
      />
      <Select
        label="Статус"
        value={status}
        onValueChange={setStatus}
        options={PROGRAM_STATUSES.filter((value) => value !== 'ARCHIVED').map((value) => ({
          value,
          label: PROGRAM_STATUS_LABELS[value],
        }))}
        error={errorFor('status')}
        hint="Архивация и возврат — отдельными кнопками в карточке."
      />
    </Modal>
  )
}
