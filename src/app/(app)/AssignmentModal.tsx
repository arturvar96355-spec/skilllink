'use client'

import { useMemo, useState } from 'react'
import {
  ASSIGNMENT_PRIORITY_LABELS,
  TEAM_LOAD_LEVEL_LABELS,
  USER_ROLE_LABELS,
  type AssignmentDto,
  type AssignmentPriority,
  type ChannelId,
  type CooperationListItemDto,
  type TeamMemberDto,
  type UniversityListItemDto,
} from '@/shared/contracts'
import {
  Button,
  Input,
  Modal,
  RemoteSelect,
  Select,
  Textarea,
  apiPost,
  cooperationOption,
  fieldErrors,
  formatPersonShort,
  universityFullOption,
  useIdempotencyKey,
  useMutation,
  useToast,
} from '@/ui'
import { QUICK_DUE, activeQuickDue, quickDueDate, todayMoscow } from './assignment-view'
import styles from './Assignments.module.css'

/** Длина текста — та же, что проверяет сервер (`ASSIGNMENT_TEXT_MAX`) и CHECK базы. */
const TEXT_MAX = 300

const MESSENGER_NAMES: Record<ChannelId, string> = { telegram: 'Телеграме', max: 'MAX', vk: 'ВКонтакте' }

const PRIORITIES: AssignmentPriority[] = ['NORMAL', 'HIGH']

/** «Кириллов П. А. — нагрузка: перегружен»: кому давать, видно сразу, кто и так перегружен. */
function memberOption(member: TeamMemberDto) {
  const tail = member.load
    ? `нагрузка: ${TEAM_LOAD_LEVEL_LABELS[member.load.level].toLowerCase()}`
    : (member.position ?? USER_ROLE_LABELS[member.role])
  return { value: member.id, label: `${formatPersonShort(member.fullName)} — ${tail}` }
}

/**
 * Окно «Дать поручение» (решение 207, макет `poruchenie-okno-*.png`): кому, что сделать,
 * вуз или связка (необязательно), срок с быстрым выбором, важность. Под «Кому» — куда
 * уйдёт уведомление: колокольчик SkillLink всегда, мессенджер — если сотрудник его
 * подключил. Кнопку открытия показывает только тот, у кого `canAssignTasks`; сервер
 * всё равно проверит право сам.
 */
export function AssignmentModal({
  members,
  initialAssigneeId,
  onClose,
}: {
  members: TeamMemberDto[]
  initialAssigneeId?: string | null
  onClose: (created: AssignmentDto | null) => void
}) {
  const toast = useToast()
  const today = todayMoscow()
  const idempotency = useIdempotencyKey()
  const [assigneeId, setAssigneeId] = useState(initialAssigneeId ?? '')
  const [text, setText] = useState('')
  const [universityId, setUniversityId] = useState('')
  const [cooperationId, setCooperationId] = useState('')
  const [dueDate, setDueDate] = useState(() => quickDueDate('friday', today))
  const [priority, setPriority] = useState<AssignmentPriority>('NORMAL')

  const options = useMemo(() => members.map(memberOption), [members])
  const assignee = members.find((member) => member.id === assigneeId) ?? null

  const submit = useMutation(async (body: Record<string, unknown>) => {
    const result = await apiPost<AssignmentDto>('/api/assignments', body, { idempotencyKey: idempotency.key })
    return result.data
  })
  const errors = fieldErrors(submit.error)
  const errorFor = (field: string) => errors.find((item) => item.field === field)?.message ?? null

  const quick = activeQuickDue(dueDate, today)
  const trimmed = text.trim()
  const canSubmit = assigneeId !== '' && trimmed !== '' && dueDate !== ''

  async function onSave() {
    const result = await submit.run({
      assigneeId,
      text: trimmed,
      universityId: universityId || null,
      cooperationId: cooperationId || null,
      dueDate,
      priority,
    })
    if (!result.ok) {
      if (result.error.code !== 'VALIDATION_ERROR' || fieldErrors(result.error).length === 0) toast.error(result.error.message)
      return
    }
    toast.success(`Поручение для ${assignee ? formatPersonShort(assignee.fullName) : 'сотрудника'} создано`)
    onClose(result.data)
  }

  const notice = assignee
    ? assignee.messenger
      ? `Уведомим в SkillLink и в ${MESSENGER_NAMES[assignee.messenger]}.`
      : 'Уведомим в SkillLink. Мессенджер у сотрудника не подключён.'
    : 'Уведомим в SkillLink и в мессенджере, если сотрудник его подключил.'

  return (
    <Modal
      isOpen
      onClose={() => onClose(null)}
      title="Новое поручение"
      help={{ topic: 'assignments', section: 'give' }}
      description="Появится у сотрудника в «Моих поручениях» со статусом «Новое»."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(null)}>
            Отмена
          </Button>
          <Button variant="primary" onClick={onSave} isLoading={submit.isPending} disabled={!canSubmit}>
            Дать поручение
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <div>
          <Select
            label="Кому"
            required
            value={assigneeId}
            onValueChange={setAssigneeId}
            placeholder="Выберите сотрудника"
            options={options}
            error={errorFor('assigneeId')}
          />
          <p className={styles.notice}>{notice}</p>
        </div>

        <Textarea
          label="Что сделать"
          required
          rows={3}
          maxLength={TEXT_MAX}
          name="assignment-text"
          autoComplete="off"
          placeholder="Например: позвонить в МТУСИ и подтвердить состав кафедры…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          error={errorFor('text')}
          hint={`${text.length} из ${TEXT_MAX}`}
        />

        <div role="group" aria-labelledby="assignment-place">
          <p id="assignment-place" className={styles.groupLabel}>
            Вуз или связка <span className={styles.optional}>необязательно</span>
          </p>
          <div className={styles.pair}>
            <RemoteSelect<UniversityListItemDto>
              label="Вуз"
              endpoint="/api/universities"
              params={{ sort: 'name' }}
              toOption={universityFullOption}
              value={universityId}
              onValueChange={(next) => {
                setUniversityId(next)
                setCooperationId('')
              }}
              placeholder="Без привязки"
              error={errorFor('universityId')}
            />
            <RemoteSelect<CooperationListItemDto>
              label="Связка"
              endpoint="/api/cooperations"
              params={{ universityId: universityId || undefined, sort: '-updatedAt' }}
              toOption={cooperationOption}
              value={cooperationId}
              onValueChange={setCooperationId}
              disabled={universityId === ''}
              placeholder={universityId === '' ? 'Сначала вуз' : 'Весь вуз'}
              emptyPlaceholder="У вуза нет связок"
              error={errorFor('cooperationId')}
            />
          </div>
        </div>

        <div className={[styles.pair, styles.pairDue].join(' ')}>
          <div>
            <Input
              label="Срок"
              required
              type="date"
              min={today}
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              error={errorFor('dueDate')}
            />
            <div className={styles.chips} role="group" aria-label="Быстрый выбор срока">
              {QUICK_DUE.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={styles.chip}
                  aria-pressed={quick === item.key}
                  onClick={() => setDueDate(quickDueDate(item.key, today))}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p id="assignment-priority" className={styles.groupLabel}>
              Важность
            </p>
            <div className={styles.segments} role="radiogroup" aria-labelledby="assignment-priority">
              {PRIORITIES.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={priority === value}
                  tabIndex={priority === value ? 0 : -1}
                  className={styles.segment}
                  onClick={() => setPriority(value)}
                  onKeyDown={(event) => {
                    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                      event.preventDefault()
                      const next = priority === 'NORMAL' ? 'HIGH' : 'NORMAL'
                      setPriority(next)
                      const siblings = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                      siblings?.[PRIORITIES.indexOf(next)]?.focus()
                    }
                  }}
                >
                  {ASSIGNMENT_PRIORITY_LABELS[value]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
