'use client'

import { useState } from 'react'
import type {
  CooperationListItemDto,
  InboundLetterDto,
  InboundLetterGroup,
  UniversityListItemDto,
} from '@/shared/contracts'
import { INBOUND_LETTER_GROUP_LABELS } from '@/shared/contracts'
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
  universityFullOption,
  useMutation,
  useToast,
} from '@/ui'
import { INBOUND_LETTER_GROUP_OPTIONS } from './letters-options'
import { incorrectReviewProblems, missingFieldsText, type IncorrectReviewField } from './review-form'
import styles from './letters-modals.module.css'

/**
 * «Верно» и «Неверно» (решение 170/171, вариант 2 ТЗ «Письма вузов»): проверка
 * доступна, пока обращение не разобрано окончательно (`NEW`/`ANALYZED`), дальше
 * сервер отвечает `CONFLICT` — тот же отказ показывается пользователю целиком.
 *
 * Модальное окно — для действия (правило проекта: панель показывает, окно
 * делает): «Верно» — подтверждение того, что уже показано в карточке,
 * «Неверно» — форма с обязательным комментарием, что было не так.
 */
export function ReviewModal({
  isOpen,
  onClose,
  letter,
  mode,
  onDone,
}: {
  isOpen: boolean
  onClose: () => void
  letter: InboundLetterDto
  mode: 'CORRECT' | 'INCORRECT'
  onDone: (updated: InboundLetterDto) => void
}) {
  const toast = useToast()
  const [universityId, setUniversityId] = useState(letter.current.universityId ?? '')
  const [cooperationId, setCooperationId] = useState(letter.current.cooperationId ?? '')
  const [group, setGroup] = useState<string>(letter.current.group ?? '')
  const [action, setAction] = useState(letter.current.action ?? '')
  const [comment, setComment] = useState('')
  // Подсказки под полями появляются после первой попытки сохранить (решение 210, S9).
  const [triedToSave, setTriedToSave] = useState(false)

  const review = useMutation(
    async (input: Record<string, unknown>) =>
      (await apiPost<InboundLetterDto>(`/api/inbound-letters/${letter.id}/review`, input)).data,
  )

  async function submitCorrect() {
    const result = await review.run({ verdict: 'CORRECT' })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Разбор подтверждён: «Верно»')
    onDone(result.data)
  }

  async function submitIncorrect() {
    setTriedToSave(true)
    const missing = missingFieldsText(incorrectReviewProblems({ universityId, group, action, comment }))
    if (missing) {
      toast.error(missing)
      return
    }
    const trimmedComment = comment.trim()
    const trimmedAction = action.trim()
    const result = await review.run({
      verdict: 'INCORRECT',
      universityId,
      cooperationId: cooperationId || undefined,
      group,
      action: trimmedAction,
      comment: trimmedComment,
    })
    if (!result.ok) {
      // 422 с полями — подсказки уже под полями, в сообщении — первая из них.
      toast.error(fieldErrors(result.error)[0]?.message ?? result.error.message)
      return
    }
    toast.success('Разбор исправлен: система учтёт пример')
    onDone(result.data)
  }

  if (mode === 'CORRECT') {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Подтвердить разбор — «Верно»"
        description="Вуз, связка, группа и действие останутся такими, как их нашла система. Это станет размеченным примером для обучения разбора."
        footer={
          <Button variant="primary" icon="check" onClick={submitCorrect} isLoading={review.isPending}>
            Подтвердить
          </Button>
        }
      >
        <dl>
          <ReadonlyFact label="Вуз" value={letter.current.universityName ?? 'Не определён'} />
          <ReadonlyFact
            label="Группа"
            value={letter.current.group ? INBOUND_LETTER_GROUP_LABELS[letter.current.group] : 'Не определена'}
          />
          <ReadonlyFact label="Предлагаемое действие" value={letter.current.action ?? 'Не предложено'} />
        </dl>
      </Modal>
    )
  }

  // Кнопка не серая: форма сама называет, чего не хватает (решение 210, S9).
  const problems = triedToSave ? incorrectReviewProblems({ universityId, group, action, comment }) : {}
  const serverErrors = fieldErrors(review.error)
  const errorFor = (field: IncorrectReviewField) =>
    problems[field] ?? serverErrors.find((item) => item.field === field)?.message ?? null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Исправить разбор — «Неверно»"
      description="Укажите, как на самом деле, и обязательно — что было не так: разбор следующих писем учится на этом примере."
      wide
      closeOnBackdrop={false}
      footer={
        <Button
          variant="primary"
          icon="check"
          onClick={submitIncorrect}
          isLoading={review.isPending}
        >
          Сохранить исправление
        </Button>
      }
    >
      <div className={styles.form}>
        <RemoteSelect<UniversityListItemDto>
          label="Вуз"
          required
          endpoint="/api/universities"
          params={{ withRating: 'false', sort: 'name' }}
          toOption={universityFullOption}
          placeholder="Выберите вуз"
          error={errorFor('universityId')}
          value={universityId}
          onValueChange={(value) => {
            setUniversityId(value)
            // Связка принадлежит вузу: после смены вуза прежний выбор дал бы
            // заведомо неверную пару (проверяется и на сервере, 422).
            setCooperationId('')
          }}
        />
        <RemoteSelect<CooperationListItemDto>
          label="Связка"
          endpoint="/api/cooperations"
          params={{ universityId: universityId || undefined }}
          toOption={cooperationOption}
          placeholder="Без связки"
          value={cooperationId}
          onValueChange={setCooperationId}
          disabled={universityId === ''}
        />
        <Select
          label="Группа"
          required
          placeholder="Выберите группу"
          error={errorFor('group')}
          value={group}
          onValueChange={(value) => setGroup(value as InboundLetterGroup)}
          options={INBOUND_LETTER_GROUP_OPTIONS}
        />
        <Input
          label="Предлагаемое действие"
          required
          placeholder="Короткая фраза: что сделать ответственному"
          error={errorFor('action')}
          value={action}
          onChange={(event) => setAction(event.target.value)}
        />
        <Textarea
          label="Что было не так"
          required
          rows={3}
          placeholder="Например: вуз определён неверно — почта личная, не рабочая"
          hint="Комментарий обязателен: он остаётся в истории вместе с решением"
          error={errorFor('comment')}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </div>
    </Modal>
  )
}

/** «Не по работе» — письмо отклоняется как не относящееся к обращению вуза. */
export function DismissModal({
  isOpen,
  onClose,
  letterId,
  onDone,
}: {
  isOpen: boolean
  onClose: () => void
  letterId: string
  onDone: (updated: InboundLetterDto) => void
}) {
  const toast = useToast()
  const [comment, setComment] = useState('')

  const dismiss = useMutation(
    async (input: { comment?: string }) =>
      (await apiPost<InboundLetterDto>(`/api/inbound-letters/${letterId}/dismiss`, input)).data,
  )

  async function onSubmit() {
    const trimmed = comment.trim()
    const result = await dismiss.run({ comment: trimmed === '' ? undefined : trimmed })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Письмо отклонено: не по работе')
    onDone(result.data)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Отклонить письмо — «Не по работе»"
      description="Задание не создаётся, и пример не идёт в статистику точности разбора: это не письмо вуза по сотрудничеству, а не ошибка разбора."
      footer={
        <Button variant="danger" icon="block" onClick={onSubmit} isLoading={dismiss.isPending}>
          Отклонить
        </Button>
      }
    >
      <Textarea
        label="Комментарий"
        rows={3}
        placeholder="Необязательно: например, рассылка не по вузу"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
    </Modal>
  )
}

function ReadonlyFact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>{value}</dd>
    </div>
  )
}
