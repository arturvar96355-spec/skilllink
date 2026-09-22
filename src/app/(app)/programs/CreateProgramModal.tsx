'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  PROGRAM_LEVELS,
  PROGRAM_LEVEL_LABELS,
  PROGRAM_STATUSES,
  PROGRAM_STATUS_LABELS,
  type ProgramDto,
  type UniversityListItemDto,
} from '@/shared/contracts'
import {
  Button,
  Input,
  Modal,
  Select,
  apiPost,
  fieldErrors,
  programHref,
  useMutation,
  useResource,
  useToast,
} from '@/ui'

/**
 * Создание образовательной программы (раздел 16 шаблона страниц).
 *
 * Показатели набора здесь не спрашиваются: заявки, обучающихся и группы
 * вносит вуз через свой кабинет, а у новой программы их обычно ещё нет.
 * Пустые показатели — это «Нет данных», а не ноль, и выдумывать их нельзя.
 */
export function CreateProgramModal({
  defaultUniversityId,
  onClose,
}: {
  defaultUniversityId?: string
  onClose: (created: boolean) => void
}) {
  const router = useRouter()
  const toast = useToast()

  const universities = useResource<UniversityListItemDto[]>(
    '/api/universities?withRating=false&pageSize=100&sort=name',
  )

  const [universityId, setUniversityId] = useState(defaultUniversityId ?? '')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [direction, setDirection] = useState('')
  const [level, setLevel] = useState<string>('BACHELOR')
  const [durationMonths, setDurationMonths] = useState('')
  const [status, setStatus] = useState<string>('ACTIVE')

  const create = useMutation(async (body: Record<string, unknown>) => {
    const result = await apiPost<ProgramDto>('/api/programs', body)
    return result.data
  })

  const errors = fieldErrors(create.error)
  const errorFor = (field: string) => errors.find((item) => item.field === field)?.message ?? null

  async function submit() {
    const duration = durationMonths.trim() === '' ? null : Number(durationMonths)
    const result = await create.run({
      universityId,
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

    toast.success(`Программа «${result.data.name}» создана`)
    onClose(true)
    router.push(programHref(result.data.id))
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(false)}
      title="Создать программу"
      description="Программа принадлежит вузу. Навыки и показатели набора добавляются потом в её карточке."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={create.isPending}>
            Создать
          </Button>
        </>
      }
    >
      <Select
        label="Вуз"
        required
        value={universityId}
        onValueChange={setUniversityId}
        placeholder={universities.isLoading ? 'Загрузка…' : 'Выберите вуз'}
        options={(universities.data ?? []).map((row) => ({
          value: row.id,
          label: row.shortName ? `${row.name} (${row.shortName})` : row.name,
        }))}
        error={errorFor('universityId')}
      />
      <Input
        label="Название"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errorFor('name')}
        placeholder="Программная инженерия"
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
        placeholder="Информатика и вычислительная техника"
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
        options={PROGRAM_STATUSES.map((value) => ({ value, label: PROGRAM_STATUS_LABELS[value] }))}
        error={errorFor('status')}
      />
    </Modal>
  )
}
