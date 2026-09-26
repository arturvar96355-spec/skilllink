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
  apiPatch,
  dateInputToIso,
  dateTimeInputToIso,
  dateToDateTimeInput,
  fieldErrors,
  isoToDateInput,
  useMutation,
  useResource,
  useToast,
} from '@/ui'

/**
 * Правка встречи (задача «Данные без экрана», пункт 2) — по образцу `CreateMeetingModal`.
 *
 * `PATCH /api/meetings/:id` было готово с самого начала, но встречи только
 * показывались и записывались заново — исправить тему, итог или следующий шаг
 * уже записанной встречи было нельзя. Участники здесь не правятся по той же
 * причине, что и при записи: их можно поменять через API, а для правки итога
 * и следующего шага они не нужны — `participants` в тело PATCH не попадает.
 */
export function EditMeetingModal({
  meeting,
  onClose,
}: {
  meeting: MeetingDto
  onClose: (updated: MeetingDto | null) => void
}) {
  const toast = useToast()

  const [topic, setTopic] = useState(meeting.topic)
  const [date, setDate] = useState(() => dateToDateTimeInput(new Date(meeting.date)))
  const [format, setFormat] = useState<MeetingFormat>(meeting.format)
  const [result, setResult] = useState(meeting.result ?? '')
  const [nextAction, setNextAction] = useState(meeting.nextAction ?? '')
  const [nextActionDueAt, setNextActionDueAt] = useState(isoToDateInput(meeting.nextActionDueAt))
  const [responsibleId, setResponsibleId] = useState(meeting.responsible.id)

  const users = useResource<UserDto[]>('/api/users?pageSize=100')

  const save = useMutation(async (body: Record<string, unknown>) => {
    const response = await apiPatch<MeetingDto>(`/api/meetings/${meeting.id}`, body)
    return response.data
  })

  const errors = fieldErrors(save.error)
  const errorFor = (field: string) => errors.find((item) => item.field === field)?.message ?? null

  async function submit() {
    const trimmedAction = nextAction.trim()
    const outcome = await save.run({
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

    toast.success('Встреча изменена')
    onClose(outcome.data)
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(null)}
      title="Изменить встречу"
      description="Тема, время, итог и следующий шаг. Следующий шаг без срока не принимается."
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
          .filter((row) => canBeResponsible(row.role))
          .map((row) => ({
            value: row.id,
            label: `${row.fullName} — ${USER_ROLE_LABELS[row.role]}`,
          }))}
        valueLabel={users.data ? undefined : meeting.responsible.fullName}
        error={errorFor('responsibleId')}
      />
    </Modal>
  )
}
