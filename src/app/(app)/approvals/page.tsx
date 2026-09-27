'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import {
  APPROVAL_ACTION_LABELS,
  type ApprovalDto,
  type ApprovalListMetaDto,
  type ApprovalScope,
} from '@/shared/contracts'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  HelpHint,
  InfoHint,
  PageHeader,
  Pagination,
  Queue,
  QueueGroup,
  QueueRow,
  Section,
  TableSkeleton,
  Tabs,
  Textarea,
  apiPatch,
  apiPost,
  buildQuery,
  formatDateTime,
  formatPersonShort,
  formatRelative,
  queueRowLabel,
  useCurrentUser,
  useMutation,
  usePageInRange,
  useResource,
  useToast,
  notifyApprovalsChanged,
} from '@/ui'
import {
  APPROVAL_TABS,
  approvalStep,
  approvalTabOf,
  approvalTargetText,
  approvalTitle,
  approvalTone,
  approvalValue,
  decisionText,
  executionBody,
  executionDoneText,
  groupApprovals,
  isApprovalScope,
  type ApprovalStep,
} from './approvals-view'
import styles from './approvals.module.css'

const PAGE_SIZE = 20

/** Пустая вкладка — что здесь появится и откуда. */
const EMPTY: Record<ApprovalScope, { title: string; description: string }> = {
  awaiting: {
    title: 'Ничего не ждёт вашего решения',
    description: 'Когда другой администратор попросит согласовать операцию, запрос появится здесь и в колокольчике.',
  },
  mine: {
    title: 'Вы ничего не отправляли на согласование',
    description:
      'Запрос отправляется из окна пользователя: «Настройки» → «Пользователи» — назначьте роль «Администратор» или заблокируйте администратора.',
  },
  history: {
    title: 'Решений пока нет',
    description: 'Здесь будут согласованные, отклонённые, выполненные и истёкшие запросы всех администраторов.',
  },
}

/** Главная кнопка строки — одна, справа (решение 206). */
const STEP_BUTTON: Partial<Record<Exclude<ApprovalStep, null>, { label: string; icon: 'check' | 'play' }>> = {
  approve: { label: 'Согласовать', icon: 'check' },
  run: { label: 'Выполнить', icon: 'play' },
}

const MODE_HINT =
  'Опасные операции — назначение администратором и блокировка администратора. Требование включается на сервере ' +
  'переменной APPROVALS_REQUIRED=true. Одобрение срабатывает один раз и только на ту операцию и того человека, ' +
  'для которых его просили.'

/**
 * «Согласования» — «четыре глаза» (решения 133, 218).
 *
 * Три вкладки: что ждёт моего решения, мои запросы, история. Строка — очередь
 * `QueueRow` (решение 206): что и над кем, кто просит и когда, справа срок и одно
 * действие. Раскрытие — причина, срок, решение, «Отклонить» с причиной. Свой
 * запрос согласовать нельзя — это сказано словами, а не спрятанной кнопкой.
 */
function ApprovalsContent() {
  const me = useCurrentUser()
  const toast = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const openParam = searchParams.get('open')
  const tabParam = searchParams.get('tab')

  const [tab, setTab] = useState<ApprovalScope>(isApprovalScope(tabParam) ? tabParam : 'awaiting')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(openParam)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [pending, setPending] = useState<{
    id: string
    kind: 'approve' | 'reject' | 'run'
  } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // Переход из колокольчика (`?open=`): вкладку выбирает сам запрос — ждёт меня, мой или в истории.
  const opened = useResource<ApprovalDto[]>(
    openParam && !isApprovalScope(tabParam) ? '/api/admin/approvals?pageSize=100' : null,
  )
  useEffect(() => {
    if (!openParam || !opened.data) return
    const found = opened.data.find((item) => item.id === openParam)
    if (found) setTab(approvalTabOf(found, me.id, Date.now()))
  }, [openParam, opened.data, me.id])

  const list = useResource<ApprovalDto[]>(
    `/api/admin/approvals${buildQuery({ scope: tab, page, pageSize: PAGE_SIZE })}`,
    { keepPreviousData: true },
  )
  usePageInRange(page, setPage, list.meta)
  const meta = list.meta as ApprovalListMetaDto | null

  // Остаток срока в строках не застывает: раз в минуту пересчитываем «ещё N ч».
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const decide = useMutation(
    async (input: { item: ApprovalDto; kind: 'approve' | 'reject' | 'run'; reason?: string }) => {
      setPending({ id: input.item.id, kind: input.kind })
      try {
        if (input.kind === 'approve') await apiPost(`/api/admin/approvals/${input.item.id}/approve`)
        if (input.kind === 'reject') {
          await apiPost(
            `/api/admin/approvals/${input.item.id}/reject`,
            input.reason ? { reason: input.reason } : undefined,
          )
        }
        if (input.kind === 'run') {
          await apiPatch(
            `/api/users/${String(input.item.payload.userId)}`,
            executionBody(input.item.action, input.item.id),
          )
        }
        return input
      } finally {
        setPending(null)
      }
    },
  )

  async function act(item: ApprovalDto, kind: 'approve' | 'reject' | 'run', reason?: string) {
    const result = await decide.run({ item, kind, reason })
    if (!result.ok) {
      // Текст отказа — с сервера: он объясняет, почему (свой запрос, срок вышел, уже решено).
      toast.error(result.error.message)
      list.reload()
      return
    }
    const title = approvalTitle(item)
    if (kind === 'approve') toast.success(`Согласовано: ${title} — выполнит тот, кто просил`)
    if (kind === 'reject')
      toast.success(item.requestedBy.id === me.id ? `Запрос отозван: ${title}` : `Отклонено: ${title}`)
    if (kind === 'run') toast.success(executionDoneText(item))
    setRejecting(null)
    setRejectReason('')
    list.reload()
    notifyApprovalsChanged()
  }

  function changeTab(key: string) {
    if (!isApprovalScope(key)) return
    setTab(key)
    setPage(1)
    setOpenId(null)
    setRejecting(null)
    if (openParam || tabParam) router.replace('/approvals')
  }

  const rows = list.data ?? []
  const viewer = { id: me.id, isReviewer: me.isReviewer }
  const groups = groupApprovals(rows, viewer, now)
  const tabs = APPROVAL_TABS.map((item) => ({
    key: item.key,
    label: item.label,
    // Число — только там, где ждут моего действия: иначе «Мои запросы 3» читалось бы как «3 дела».
    count:
      item.key === 'awaiting'
        ? (meta?.awaiting ?? null)
        : item.key === 'mine' && meta?.readyToRun
          ? meta.readyToRun
          : null,
  }))

  function detail(item: ApprovalDto, step: ApprovalStep) {
    const decision = decisionText(item)
    const mine = item.requestedBy.id === me.id
    const isRejecting = rejecting === item.id
    const busy = pending?.id === item.id
    return (
      <div className={styles.detail}>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Операция</dt>
            <dd>{APPROVAL_ACTION_LABELS[item.action]}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Над кем</dt>
            <dd>
              {approvalTargetText(item)}
              {item.target && !me.isReviewer && (
                <>
                  {' '}
                  <Link className={styles.link} href={`/settings?user=${encodeURIComponent(item.target.id)}#users`}>
                    Открыть пользователя
                  </Link>
                </>
              )}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Кто просит</dt>
            <dd>
              {mine ? 'Вы' : item.requestedBy.fullName}, {formatDateTime(item.createdAt)}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Причина</dt>
            <dd className={item.reason ? styles.quote : undefined}>{item.reason ?? 'Не указана'}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Срок</dt>
            <dd>до {formatDateTime(item.expiresAt)}</dd>
          </div>
          {decision && (
            <div className={styles.fact}>
              <dt>Решение</dt>
              <dd>
                {decision}
                {item.decidedAt ? `, ${formatDateTime(item.decidedAt)}` : ''}
                {item.consumedAt ? `. Выполнено ${formatDateTime(item.consumedAt)}` : ''}
              </dd>
            </div>
          )}
          {item.rejectReason && (
            <div className={styles.fact}>
              <dt>Почему отклонено</dt>
              <dd className={styles.quote}>{item.rejectReason}</dd>
            </div>
          )}
        </dl>

        {step === 'withdraw' && (
          <p className={styles.note}>
            Свой запрос согласовать нельзя — решает другой администратор. Передумали — отзовите запрос.
          </p>
        )}
        {step === 'run' && (
          <p className={styles.note}>
            Согласовано. Нажмите «Выполнить» — операция пройдёт один раз и только над этим человеком.
          </p>
        )}
        {step === null && me.isReviewer && item.status === 'REQUESTED' && (
          <p className={styles.note}>Учётная запись эксперта видит запросы, но решать не может.</p>
        )}

        {isRejecting ? (
          <div className={styles.reject}>
            <Textarea
              label={mine ? 'Почему отзываете' : 'Почему отклоняете'}
              hint={mine ? 'Можно не заполнять' : 'Увидит тот, кто просил'}
              rows={2}
              maxLength={500}
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              autoFocus
            />
            <div className={styles.actions}>
              <Button variant="ghost" size="sm" onClick={() => setRejecting(null)}>
                Отмена
              </Button>
              <Button
                variant="danger"
                size="sm"
                icon="close"
                onClick={() => act(item, 'reject', rejectReason.trim() || undefined)}
                isLoading={busy && pending?.kind === 'reject'}
                disabled={!mine && rejectReason.trim() === ''}
              >
                {mine ? 'Отозвать запрос' : 'Отклонить'}
              </Button>
            </div>
          </div>
        ) : (
          (step === 'approve' || step === 'withdraw' || step === 'run') && (
            <div className={styles.actions}>
              {step === 'approve' && (
                <Button
                  variant="primary"
                  size="sm"
                  icon="check"
                  onClick={() => act(item, 'approve')}
                  isLoading={busy && pending?.kind === 'approve'}
                >
                  Согласовать
                </Button>
              )}
              {step === 'run' && (
                <Button
                  variant="primary"
                  size="sm"
                  icon="play"
                  onClick={() => act(item, 'run')}
                  isLoading={busy && pending?.kind === 'run'}
                >
                  Выполнить
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRejectReason('')
                  setRejecting(item.id)
                }}
              >
                {mine ? 'Отозвать запрос' : 'Отклонить'}
              </Button>
            </div>
          )
        )}
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title="Согласования"
        description="Назначить администратором и заблокировать администратора можно только вдвоём: один просит, другой согласует, затем первый выполняет."
        meta={<HelpHint topic="approvals" />}
      />

      {meta && (
        <p className={styles.mode}>
          {meta.required
            ? `Требование включено: без согласования эти операции не выполняются. Запрос действует ${meta.ttlHours} ч.`
            : 'На этом стенде требование выключено: операции выполняются сразу. Запросы и решения работают — их можно опробовать.'}
          <InfoHint text={MODE_HINT} />
        </p>
      )}

      <Tabs items={tabs} active={tab} onChange={changeTab} />

      <Section>
        {list.isLoading ? (
          <TableSkeleton rows={4} columns={2} />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : rows.length === 0 ? (
          <Card muted>
            <EmptyState
              icon="lock"
              title={EMPTY[tab].title}
              description={EMPTY[tab].description}
              action={
                tab === 'mine' ? (
                  <Button href="/settings#users" variant="secondary" icon="user">
                    Открыть «Пользователи»
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <>
            <Queue>
              {groups.map((group) => (
                <QueueGroup
                  key={group.key}
                  label={group.label}
                  count={group.items.length}
                  // «17 из 18» — только когда группа одна, а список разбит на страницы.
                  total={groups.length === 1 ? meta?.total : undefined}
                >
                  {group.items.map((item) => {
                    const step = approvalStep(item, viewer, now)
                    const button = step ? STEP_BUTTON[step] : undefined
                    const title = approvalTitle(item)
                    const isOpen = openId === item.id
                    // «ваш запрос», а не «просит вы»; чужой — «просит Соловьёва М. Д.».
                    const who =
                      item.requestedBy.id === me.id ? 'ваш запрос' : `просит ${formatPersonShort(item.requestedBy.fullName)}`
                    const value = approvalValue(item, now)
                    return (
                      <QueueRow
                        key={item.id}
                        tone={approvalTone(item, now)}
                        title={title}
                        meta={{
                          text: item.reason ?? 'Причина не указана',
                          tail: `${who}, ${formatRelative(item.createdAt, now)}`,
                          // На телефоне хвост короче — иначе причина ужимается до многоточия.
                          tailShort: formatRelative(item.createdAt, now),
                          tailTitle: `${who}, ${formatDateTime(item.createdAt)}`,
                        }}
                        value={value}
                        label={queueRowLabel([
                          title,
                          who,
                          value.text,
                          isOpen ? 'Свернуть подробности' : 'Показать подробности',
                        ])}
                        expanded={isOpen}
                        onToggle={() => {
                          setOpenId(isOpen ? null : item.id)
                          setRejecting(null)
                        }}
                        action={
                          button ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={button.icon}
                              onClick={() => act(item, step === 'run' ? 'run' : 'approve')}
                              isLoading={pending?.id === item.id && pending.kind !== 'reject'}
                              aria-label={`${button.label}: ${title}`}
                            >
                              {button.label}
                            </Button>
                          ) : undefined
                        }
                        detail={detail(item, step)}
                      />
                    )
                  })}
                </QueueGroup>
              ))}
            </Queue>
            {meta && meta.total > PAGE_SIZE && (
              <Pagination
                page={meta.page}
                pageSize={meta.pageSize}
                total={meta.total}
                onPageChange={setPage}
                nouns={['запрос', 'запроса', 'запросов']}
              />
            )}
          </>
        )}
      </Section>
    </>
  )
}

/** `useSearchParams` требует границы Suspense — иначе сборка страницы не проходит. */
export default function ApprovalsPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={4} columns={2} />}>
      <ApprovalsContent />
    </Suspense>
  )
}
