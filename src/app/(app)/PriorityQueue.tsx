'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  RECOMMENDATION_STATUS_ACTIONS,
  type RecommendationDto,
  type RecommendationStatus,
} from '@/shared/contracts'
import {
  Button,
  Icon,
  Queue,
  QueueGroup,
  QueueRow,
  Textarea,
  apiPatch,
  queueRowLabel,
  recommendationHref,
  recommendationTargetHref,
  toneOfPriority,
  useMutation,
  useToast,
} from '@/ui'
import { PriorityBreakdown } from './PriorityBreakdown'
import { RecommendationScore } from './RecommendationScore'
import { expandedActionId, groupActions, openLabelOf, summarizeAction } from './priority-queue'
import styles from './PriorityQueue.module.css'

/**
 * «Приоритетные действия» — очередь (решение 206, вариант A).
 *
 * Группы «Новые» и «В работе», строка — короткий заголовок с глаголом и
 * «почему» одной строкой. Справа одно действие: у новой — «Принять» (переход
 * «Новая → В работе»), у записи в работе — открыть её объект. Щелчок по строке
 * раскрывает обоснование: проверки правила и балл; первая строка раскрыта,
 * пока пользователь ничего не выбрал. «Отклонить» — в раскрытии, с основанием:
 * без него сервер отклонение не примет. Эксперт (только чтение) видит
 * раскрытие и «Подробнее», но не кнопки.
 */
export function PriorityQueue({
  actions,
  canWork,
  onChanged,
}: {
  actions: RecommendationDto[]
  canWork: boolean
  /** Статус изменён — главная перечитывает сводку: пятёрка могла смениться. */
  onChanged: () => void
}) {
  const toast = useToast()
  // undefined — пользователь ещё ничего не раскрывал (тогда раскрыта первая строка).
  const [choice, setChoice] = useState<string | null | undefined>(undefined)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  // Какая запись и в какой статус сейчас уходит — чтобы крутилась только её кнопка.
  const [pending, setPending] = useState<{ id: string; status: RecommendationStatus } | null>(null)

  const groups = groupActions(actions)
  const shown = groups.flatMap((group) => group.items)
  const openId = expandedActionId(shown, choice)

  const update = useMutation(async (input: { id: string; status: RecommendationStatus; comment?: string }) => {
    setPending({ id: input.id, status: input.status })
    try {
      const result = await apiPatch<RecommendationDto>(`/api/recommendations/${input.id}`, {
        status: input.status,
        ...(input.comment ? { comment: input.comment } : {}),
      })
      return result.data
    } finally {
      setPending(null)
    }
  })

  async function accept(item: RecommendationDto, title: string) {
    const result = await update.run({ id: item.id, status: 'IN_PROGRESS' })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(`Принято в работу: ${title}`)
    onChanged()
  }

  function startDismiss(id: string) {
    update.reset()
    setComment('')
    setDismissing(id)
  }

  function cancelDismiss() {
    update.reset()
    setDismissing(null)
    setComment('')
  }

  async function submitDismiss(item: RecommendationDto) {
    const result = await update.run({ id: item.id, status: 'DISMISSED', comment: comment.trim() })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Задача отклонена, основание сохранено')
    setDismissing(null)
    setComment('')
    setChoice(null)
    onChanged()
  }

  function toggle(id: string) {
    if (dismissing && dismissing !== id) cancelDismiss()
    setChoice(openId === id ? null : id)
  }

  return (
    <Queue>
      {groups.map((group) => (
        <QueueGroup key={group.key} label={group.label} count={group.items.length}>
          {group.items.map((item) => {
            const summary = summarizeAction(item)
            const isOpen = openId === item.id
            const openLabel = openLabelOf(item.target)
            const isPending = pending?.id === item.id
            return (
              <QueueRow
                key={item.id}
                tone={toneOfPriority(item.priority)}
                title={summary.title}
                meta={{ text: summary.why }}
                label={queueRowLabel([
                  summary.title,
                  summary.why,
                  isOpen ? 'Свернуть обоснование' : 'Показать обоснование',
                ])}
                expanded={isOpen}
                onToggle={() => toggle(item.id)}
                action={
                  !canWork ? undefined : item.status === 'NEW' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="check"
                      onClick={() => accept(item, summary.title)}
                      isLoading={isPending && pending?.status === 'IN_PROGRESS'}
                      aria-label={`${RECOMMENDATION_STATUS_ACTIONS.IN_PROGRESS} в работу: ${summary.title}`}
                    >
                      {RECOMMENDATION_STATUS_ACTIONS.IN_PROGRESS}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="arrowRight"
                      href={recommendationTargetHref(item.target)}
                      aria-label={`${openLabel}: ${item.target.label}`}
                    >
                      {openLabel}
                    </Button>
                  )
                }
                detail={
                  <div className={styles.detail}>
                    {item.ruleKey === 'cooperation.no-product' && item.status === 'IN_PROGRESS' && (
                      <p className={styles.note}>
                        Закроется сама при пересборке, когда у связки появится продукт: закрыть раньше система не даст.
                      </p>
                    )}
                    {item.reasons.length > 0 ? (
                      <ul className={styles.checks} aria-label="Проверки правила">
                        {item.reasons.map((reason) => (
                          <li key={reason.code} className={styles.check} data-pass={reason.pass ? 'yes' : 'no'}>
                            <Icon name={reason.pass ? 'check' : 'close'} size={16} className={styles.checkMark} />
                            <span>
                              <span className="visually-hidden">{reason.pass ? 'Выполнено: ' : 'Не выполнено: '}</span>
                              {reason.detail}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.note}>{item.justification}</p>
                    )}
                    <RecommendationScore score={item.score} breakdown={item.scoreBreakdown} />
                    <Link className={styles.target} href={recommendationTargetHref(item.target)}>
                      <Icon name="arrowRight" size={16} />
                      <span>{item.target.label}</span>
                    </Link>

                    {dismissing === item.id ? (
                      <form
                        className={styles.dismiss}
                        onSubmit={(event) => {
                          event.preventDefault()
                          if (comment.trim()) void submitDismiss(item)
                        }}
                      >
                        <Textarea
                          label="Основание"
                          hint="Обязательное поле: без него сервер отклонение не примет. Основание сохранится в карточке задачи."
                          value={comment}
                          onChange={(event) => setComment(event.target.value)}
                          maxLength={1000}
                          autoFocus
                        />
                        {update.error && (
                          <p className={styles.refusal} role="alert">
                            {update.error.message}
                          </p>
                        )}
                        <div className={styles.detailActions}>
                          <Button
                            type="submit"
                            variant="primary"
                            size="sm"
                            disabled={comment.trim().length === 0}
                            isLoading={isPending && pending?.status === 'DISMISSED'}
                          >
                            {RECOMMENDATION_STATUS_ACTIONS.DISMISSED}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={cancelDismiss}>
                            Отмена
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div className={styles.detailActions}>
                        {canWork && (
                          <Button variant="ghost" size="sm" icon="close" onClick={() => startDismiss(item.id)}>
                            {RECOMMENDATION_STATUS_ACTIONS.DISMISSED}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" icon="recommendation" href={recommendationHref(item.id)}>
                          Подробнее
                        </Button>
                      </div>
                    )}
                  </div>
                }
              />
            )
          })}
        </QueueGroup>
      ))}
      <PriorityBreakdown />
    </Queue>
  )
}
