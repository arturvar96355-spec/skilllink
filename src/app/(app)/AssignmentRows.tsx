'use client'

import { useEffect, useRef } from 'react'
import { ASSIGNMENT_STATUS_LABELS, type AssignmentDto, type AssignmentStatus } from '@/shared/contracts'
import { Button, formatDayMonth, formatPersonShort } from '@/ui'
import { assignmentTone, dueText, nextStatusAction, placeText } from './assignment-view'
import styles from './Assignments.module.css'

/**
 * Строки поручений (решение 207) — в «Моих поручениях» личного кабинета и в боковой
 * панели сотрудника на «Команде». Та же система, что у строки очереди главной
 * (решение 206, `QueueRow` в ветке главной): полоска слева — красная только у
 * просрочки, остальное — фиолетовая гамма; текст и мета; справа срок и одна кнопка.
 * Своя разметка, а не `QueueRow`: строка поручения никуда не ведёт (у неё нет
 * страницы), и ей нужен статус-бирка в мете; когда `QueueRow` придёт в main, строку
 * можно перевести на него без изменения вида.
 *
 * Узкий блок (≤ 480 px ширины самого списка): текст в две строки, срок над кнопкой.
 */
export function AssignmentRows({
  items,
  show,
  highlightId,
  pendingId,
  onStatus,
}: {
  items: AssignmentDto[]
  /** Что написать в мете: кто поручил (у себя) или кому (у руководителя — не нужно, панель уже про человека). */
  show: 'author' | 'none'
  /** Поручение из ссылки уведомления — подсвечено и прокручено в видимую часть. */
  highlightId?: string | null
  /** Чей статус сейчас меняется — кнопка в ожидании. */
  pendingId?: string | null
  /** Сменить статус; без обработчика кнопок нет (эксперт, чтение). */
  onStatus?: (item: AssignmentDto, to: AssignmentStatus) => void
}) {
  const highlighted = useRef<HTMLLIElement>(null)
  useEffect(() => {
    highlighted.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlightId])

  return (
    <ul className={styles.rows}>
      {items.map((item) => {
        const action = nextStatusAction(item.status)
        const place = placeText(item)
        const due = dueText(item)
        const isHighlight = item.id === highlightId
        return (
          <li
            key={item.id}
            ref={isHighlight ? highlighted : undefined}
            className={styles.row}
            data-tone={assignmentTone(item)}
            data-highlight={isHighlight || undefined}
          >
            <span className={styles.ind} aria-hidden />
            <div className={styles.head}>
              <div className={styles.main}>
                <p className={styles.title}>{item.text}</p>
                <p className={styles.meta}>
                  <span className={styles.status} data-status={item.status}>
                    {ASSIGNMENT_STATUS_LABELS[item.status]}
                  </span>
                  {item.priority === 'HIGH' && <span className={styles.high}>важное</span>}
                  {place && <span className={styles.metaText}>{place}</span>}
                  {show === 'author' && (
                    <span className={styles.metaTail} title={item.author.fullName}>
                      поручил {formatPersonShort(item.author.fullName)}, {formatDayMonth(item.createdAt)}
                    </span>
                  )}
                </p>
              </div>
              <span className={styles.value} data-overdue={item.dueState === 'overdue' || undefined}>
                {due}
              </span>
              {onStatus && item.canChangeStatus && (
                <span className={styles.act}>
                  <Button
                    size="sm"
                    variant={action.to === 'DONE' ? 'secondary' : 'ghost'}
                    icon={action.to === 'DONE' ? 'check' : undefined}
                    isLoading={pendingId === item.id}
                    disabled={pendingId !== null && pendingId !== undefined && pendingId !== item.id}
                    onClick={() => onStatus(item, action.to)}
                    aria-label={`${action.label}: ${item.text}`}
                  >
                    {action.label}
                  </Button>
                </span>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
