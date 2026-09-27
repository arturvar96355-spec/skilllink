'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { AssignmentDto, AssignmentStatus } from '@/shared/contracts'
import {
  Card,
  EmptyState,
  ErrorState,
  MockBadge,
  Skeleton,
  Tabs,
  apiPatch,
  buildQuery,
  pluralize,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
} from '@/ui'
import { AssignmentRows } from '../AssignmentRows'
import { splitByDone } from '../assignment-view'
import rowStyles from '../Assignments.module.css'
import styles from './profile.module.css'

type Tab = 'open' | 'done'

/**
 * «Мои поручения» (решение 207, макет `moi-porucheniya-*.png`) — блок личного кабинета.
 * Место по макету — «Мой день» на главной, но разметку главной без команды владельца
 * не меняем: до его решения — здесь, и ссылка из колокольчика ведёт сюда
 * (`/profile?assignment=<id>#my-assignments`).
 *
 * Статус — одной кнопкой: «Взять в работу» → «Сделано» → «Вернуть в работу».
 * Эксперту кнопок нет (`canChangeStatus: false` приходит с сервера).
 */
export function MyAssignments() {
  const user = useCurrentUser()
  const toast = useToast()
  const searchParams = useSearchParams()
  const highlightId = searchParams.get('assignment')
  const list = useResource<AssignmentDto[]>(
    `/api/assignments${buildQuery({ assigneeId: user.id, pageSize: 100 })}`,
    { keepPreviousData: true },
  )
  const [tab, setTab] = useState<Tab>('open')
  const [pendingId, setPendingId] = useState<string | null>(null)

  const items = list.data ?? []
  const { open, done } = splitByDone(items)
  const overdue = open.filter((item) => item.dueState === 'overdue').length

  // Поручение из ссылки уведомления уже сделано — открыть вкладку «Сделанные», где оно есть.
  useEffect(() => {
    if (!highlightId || !list.data) return
    const found = list.data.find((item) => item.id === highlightId)
    if (found) setTab(found.status === 'DONE' ? 'done' : 'open')
  }, [highlightId, list.data])

  const changeStatus = useMutation(async (input: { id: string; status: AssignmentStatus }) => {
    const result = await apiPatch<AssignmentDto>(`/api/assignments/${input.id}`, { status: input.status })
    return result.data
  })

  async function onStatus(item: AssignmentDto, to: AssignmentStatus) {
    setPendingId(item.id)
    const result = await changeStatus.run({ id: item.id, status: to })
    setPendingId(null)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(
      to === 'DONE' ? 'Отмечено: сделано' : item.status === 'DONE' ? 'Поручение снова в работе' : 'Взято в работу',
    )
    list.reload()
  }

  const shown = tab === 'open' ? open : done

  return (
    <section id="my-assignments" className={[styles.block, rowStyles.block].join(' ')} aria-labelledby="profile-assignments">
      <div className={styles.blockHead}>
        <div>
          <h2 id="profile-assignments" className={styles.blockTitle}>
            Мои поручения
            {items.some((item) => item.isMock) && <MockBadge />}
          </h2>
          {list.data && (
            <p className={rowStyles.summary}>
              {open.length === 0
                ? 'Открытых поручений нет'
                : `${open.length} ${pluralize(open.length, ['открытое', 'открытых', 'открытых'])}`}
              {overdue > 0 && (
                <>
                  , <span className={rowStyles.summaryDanger}>просрочено {overdue}</span>
                </>
              )}
            </p>
          )}
        </div>
        {items.length > 0 && (
          <Tabs
            items={[
              { key: 'open', label: 'Открытые', count: open.length },
              { key: 'done', label: 'Сделанные', count: done.length },
            ]}
            active={tab}
            onChange={(key) => setTab(key as Tab)}
          />
        )}
      </div>

      {list.isLoading && !list.data ? (
        <Card padding="sm" aria-busy="true">
          <span className="visually-hidden">Загружаем поручения</span>
          {[0, 1, 2].map((index) => (
            <div key={index} className={rowStyles.skeletonRow}>
              <Skeleton width="60%" height="16px" />
              <Skeleton width="35%" height="12px" />
            </div>
          ))}
        </Card>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : items.length === 0 ? (
        <Card muted>
          <EmptyState
            title="Поручений нет"
            description="Когда руководитель даст вам поручение, оно появится здесь и в колокольчике уведомлений."
          />
        </Card>
      ) : shown.length === 0 ? (
        <Card muted>
          <EmptyState
            title={tab === 'open' ? 'Всё сделано' : 'Сделанных пока нет'}
            description={
              tab === 'open'
                ? 'Открытых поручений нет. Сделанные — на соседней вкладке.'
                : 'Отметьте поручение «Сделано» — оно переедет сюда.'
            }
          />
        </Card>
      ) : (
        <Card padding="sm">
          <AssignmentRows
            items={shown}
            show="author"
            highlightId={highlightId}
            pendingId={pendingId}
            onStatus={user.isReviewer ? undefined : onStatus}
          />
        </Card>
      )}
    </section>
  )
}
