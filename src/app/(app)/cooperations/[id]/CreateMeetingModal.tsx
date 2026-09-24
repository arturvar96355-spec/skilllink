'use client'

import { useState } from 'react'
import {
  MEETING_FORMATS,
  MEETING_FORMAT_LABELS,
  USER_ROLE_LABELS,
  canBeResponsible,
  type MeetingDto,
  type MeetingFormat,
  type UserDto,
} from '@/shared/contracts'
import {
  Button,
  Input,
  Modal,
  Select,
  Textarea,
  apiPost,
  dateInputToIso,
  dateTimeInputToIso,
  dateToDateTimeInput,
  fieldErrors,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
} from '@/ui'

/**
 * Запись встречи по связке.
 *
 * API встреч было готово с самого начала, а в интерфейсе встречи только
 * показывались: записать новую было нельзя, хотя ведение встреч — часть
 * работы с вузом (раздел 9 ТЗ). Участники не спрашиваются: их можно добавить
 * через API, а для записи итога и следующего шага они не нужны.
 */
export function CreateMeetingModal({
  cooperationId,
  onClose,
}: {
  cooperationId: string
  onClose: (created: boolean) => void
}) {
  const toast = useToast()
  const user = useCurrentUser()

  const [topic, setTopic] = useState('')
  const [date, setDate] = useState(() => dateToDateTimeInput())
  const [format, setFormat] = useState<MeetingFormat>('ONLINE')
  const [result, setResult] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [nextActionDueAt, setNextActionDueAt] = useState('')
  const [responsibleId, setResponsibleId] = useState(user.id)

  const users = useResource<UserDto[]>('/api/users?pageSize=100')

  const create = useMutation(async (body: Record<string, unknown>) => {
    const response = await apiPost<MeetingDto>('/api/meetings', body)
    return response.data
  })

  const errors = fieldErrors(create.error)
  const errorFor = (field: string) => errors.find((item) => item.field === field)?.message ?? null

  async function submit() {
    const trimmedAction = nextAction.trim()
    const outcome = await create.run({
      cooperationId,
      topic: topic.trim(),
      date: dateTimeInputToIso(date),
      format,
      result: result.trim() === '' ? null : result.trim(),
      nextAction: trimmedAction === '' ? null : trimmedAction,
      nextActionDueAt: trimmedAction === '' ? null : dateInputToIso(nextActionDueAt),
      responsibleId,
    })

    if (!outcome.ok) {
      if (outcome.error.code !== 'VALIDATION_ERROR') toast.error(outcome.error.message)
      return
    }

    toast.success('Встреча записана')
    onClose(true)
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(false)}
      title="Записать встречу"
      description="Что обсудили и что дальше. Следующий шаг без срока не принимается: иначе он потеряется."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={create.isPending}>
            Записать
          </Button>
        </>
      }
    >
      <Input
        label="Тема"
        required
        value={topic}
        onChange={(event) => setTopic(event.target.value)}
        error={errorFor('topic')}
        placeholder="Согласование учебного плана"
        maxLength={300}
      />

      <Input
        label="Дата и время"
        type="datetime-local"
        required
        value={date}
        onChange={(event) => setDate(event.target.value)}
        error={errorFor('date')}
      />

      <Select
        label="Формат"
        value={format}
        onValueChange={(value) => setFormat(value as MeetingFormat)}
        options={MEETING_FORMATS.map((value) => ({ value, label: MEETING_FORMAT_LABELS[value] }))}
        error={errorFor('format')}
      />

      <Textarea
        label="Итог"
        value={result}
        onChange={(event) => setResult(event.target.value)}
        error={errorFor('result')}
        maxLength={2000}
        hint="О чём договорились. Можно оставить пустым, если встреча ещё впереди."
      />

      <Input
        label="Следующий шаг"
        value={nextAction}
        onChange={(event) => setNextAction(event.target.value)}
        error={errorFor('nextAction')}
        maxLength={1000}
        placeholder="Направить проект договора"
      />

      {nextAction.trim() !== '' && (
        <Input
          label="Срок следующего шага"
          type="date"
          required
          value={nextActionDueAt}
          onChange={(event) => setNextActionDueAt(event.target.value)}
          error={errorFor('nextActionDueAt')}
        />
      )}

      <Select
        label="Ответственный"
        required
        value={responsibleId}
        onValueChange={setResponsibleId}
        placeholder={users.isLoading ? 'Загрузка…' : 'Выберите сотрудника'}
        options={(users.data ?? [])
          // Сервер примет только менеджера или администратора (RESPONSIBLE_ROLES).
          .filter((row) => canBeResponsible(row.role))
          .map((row) => ({
            value: row.id,
            label: `${row.fullName} — ${USER_ROLE_LABELS[row.role]}`,
          }))}
        valueLabel={users.data ? undefined : user.fullName}
        error={errorFor('responsibleId')}
      />
    </Modal>
  )
}
