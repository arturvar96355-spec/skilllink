'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  COOPERATION_STATUSES,
  COOPERATION_STATUS_LABELS,
  USER_ROLE_LABELS,
  type CooperationDto,
  type ProductListItemDto,
  type ProgramListItemDto,
  type UniversityListItemDto,
  type UserDto,
} from '@/shared/contracts'
import {
  Button,
  Input,
  Modal,
  RemoteSelect,
  Select,
  Textarea,
  apiPost,
  cooperationHref,
  dateInputToIso,
  fieldErrors,
  useMutation,
  useResource,
  useToast,
  universityFullOption,
} from '@/ui'

/**
 * Создание связки «вуз — программа — IT-продукт».
 *
 * Программа выбирается только после вуза и только из его программ: иначе можно
 * собрать связку из вуза и чужой программы, а сервер ответит отказом уже после
 * отправки. Продукт не обязателен — на первых этапах его может не быть
 * (решение 1 проекта).
 *
 * Сразу после создания у связки появляются все четырнадцать этапов — поэтому
 * переходим прямо в её карточку.
 */
export function CreateCooperationModal({ onClose }: { onClose: (created: boolean) => void }) {
  const router = useRouter()
  const toast = useToast()

  const [universityId, setUniversityId] = useState('')
  const [programId, setProgramId] = useState('')
  const [productId, setProductId] = useState('')
  const [responsibleId, setResponsibleId] = useState('')
  const [status, setStatus] = useState<string>('DRAFT')
  const [goal, setGoal] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [classesStartAt, setClassesStartAt] = useState('')

  const products = useResource<ProductListItemDto[]>('/api/products?pageSize=100&sort=name')
  const users = useResource<UserDto[]>('/api/users?pageSize=100')

  const create = useMutation(async (body: Record<string, unknown>) => {
    const result = await apiPost<CooperationDto>('/api/cooperations', body)
    return result.data
  })

  const errors = fieldErrors(create.error)
  const errorFor = (field: string) => errors.find((item) => item.field === field)?.message ?? null

  async function submit() {
    const result = await create.run({
      universityId,
      programId,
      productId: productId === '' ? null : productId,
      responsibleId,
      status,
      goal: goal.trim() === '' ? null : goal.trim(),
      targetDate: dateInputToIso(targetDate),
      classesStartAt: dateInputToIso(classesStartAt),
    })

    if (!result.ok) {
      if (result.error.code !== 'VALIDATION_ERROR') toast.error(result.error.message)
      return
    }

    toast.success('Связка создана: заведены все 14 этапов')
    onClose(true)
    router.push(cooperationHref(result.data.id))
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(false)}
      title="Создать связку"
      description="Вуз, его программа и, если он уже выбран, IT-продукт. Этапы работы система заведёт сама."
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
      <RemoteSelect<UniversityListItemDto>
        label="Вуз"
        required
        endpoint="/api/universities"
        params={{ withRating: 'false', sort: 'name' }}
        toOption={universityFullOption}
        searchPlaceholder="Название, краткое название или город"
        value={universityId}
        onValueChange={(value) => {
          setUniversityId(value)
          // Программа принадлежит вузу: прежний выбор после смены вуза недействителен.
          setProgramId('')
        }}
        placeholder="Выберите вуз"
        error={errorFor('universityId')}
      />

      <RemoteSelect<ProgramListItemDto>
        label="Образовательная программа"
        required
        endpoint="/api/programs"
        params={{ universityId, sort: 'name' }}
        toOption={(row) => ({ value: row.id, label: row.name })}
        value={programId}
        onValueChange={setProgramId}
        disabled={universityId === ''}
        placeholder={universityId === '' ? 'Сначала выберите вуз' : 'Выберите программу'}
        emptyPlaceholder="У вуза нет программ"
        error={errorFor('programId')}
      />

      <Select
        label="IT-продукт"
        value={productId}
        onValueChange={setProductId}
        placeholder="Пока не выбран"
        options={(products.data ?? []).map((row) => ({
          value: row.id,
          label: row.version ? `${row.name} (${row.version})` : row.name,
        }))}
        hint="Продукт можно выбрать позже — до этапа оформления это допустимо."
        error={errorFor('productId')}
      />

      <Select
        label="Ответственный"
        required
        value={responsibleId}
        onValueChange={setResponsibleId}
        placeholder={users.isLoading ? 'Загрузка…' : 'Выберите сотрудника'}
        options={(users.data ?? [])
          .filter((row) => row.role !== 'UNIVERSITY_REP')
          .map((row) => ({
            value: row.id,
            label: `${row.fullName} — ${USER_ROLE_LABELS[row.role]}`,
          }))}
        error={errorFor('responsibleId')}
      />

      <Select
        label="Статус"
        value={status}
        onValueChange={setStatus}
        options={COOPERATION_STATUSES.map((value) => ({
          value,
          label: COOPERATION_STATUS_LABELS[value],
        }))}
        error={errorFor('status')}
      />

      <Input
        label="Контрольная дата"
        type="date"
        value={targetDate}
        onChange={(event) => setTargetDate(event.target.value)}
        error={errorFor('targetDate')}
        hint="К этому сроку работа должна быть доведена до результата."
      />

      <Input
        label="Начало занятий"
        type="date"
        value={classesStartAt}
        onChange={(event) => setClassesStartAt(event.target.value)}
        error={errorFor('classesStartAt')}
      />

      <Textarea
        label="Цель"
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
        error={errorFor('goal')}
        maxLength={1000}
        hint="Зачем эта связка: что должно измениться в программе или у выпускников."
      />
    </Modal>
  )
}
