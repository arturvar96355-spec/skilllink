'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import {
  CONFIDENCE_LABELS,
  RECOMMENDATION_PRIORITIES,
  RECOMMENDATION_PRIORITY_LABELS,
  RECOMMENDATION_SORT_BY_SCORE,
  RECOMMENDATION_SORT_MOST_IMPORTANT,
  RECOMMENDATION_STATUS_ACTIONS,
  RECOMMENDATION_WORKFLOW_STATUSES,
  RECOMMENDATION_STATUS_LABELS,
  RECOMMENDATION_TYPE_LABELS,
  type AiDraftDto,
  type RecommendationDto,
  type RecommendationPriority,
  type RecommendationStatus,
  type RecommendationType,
} from '@/shared/contracts'
import {
  Button,
  Card,
  Drawer,
  EmptyState,
  ResetFilters,
  OPEN_RECOMMENDATION_STATUSES,
  CLOSED_RECOMMENDATION_STATUSES,
  ErrorState,
  HelpHint,
  Icon,
  Modal,
  PageHeader,
  Pagination,
  Queue,
  QueueGroup,
  QueueRow,
  Section,
  Select,
  TableSkeleton,
  Tabs,
  Textarea,
  Toolbar,
  ToolbarItem,
  apiPatch,
  apiPost,
  buildQuery,
  describeRelatedData,
  formatDate,
  queueRowLabel,
  recommendationTargetHref,
  toneOfPriority,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
  usePageInRange,
  type TabItem,
} from '@/ui'
import { AiAssistCard, AiDraftLoading, AiDraftView } from '../AiDraft'
import { expandedActionId } from '../priority-queue'
import { RecommendationScore } from '../RecommendationScore'
import { WhyRecommended } from '../RuleChecks'
import { RecommendationExperiment } from './ExperimentSummary'
import {
  PRIORITY_ORDER,
  canDismiss,
  groupRecommendations,
  primaryTransition,
  rowValue,
  shortPersonName,
  summarizeRecommendation,
} from './reco-view'
import styles from './recommendations.module.css'

const PAGE_SIZE = 20

/** Как список обновляется — кнопки «Пересобрать» больше нет (решение 212). */
const REFRESH_HINT =
  'Список обновляется сам: по связке — сразу при смене этапа, всё остальное (сроки, программы, навыки) — не реже раза в 10 минут. Ушла проблема — задача закрывается сама.'

const TABS: TabItem[] = [
  { key: 'all', label: 'Все' },
  { key: 'PROGRAM', label: 'Программы' },
  { key: 'UNIVERSITY', label: 'Вузы' },
  { key: 'SKILL', label: 'Навыки' },
  { key: 'ACTION', label: 'Действия' },
]

/** Значок действия справа: принять — галочка, закрыть — галочка, вернуть — стрелка по кругу. */
const ACTION_ICON: Partial<Record<RecommendationStatus, 'check' | 'refresh'>> = {
  IN_PROGRESS: 'check',
  DONE: 'check',
  NEW: 'refresh',
}

interface Filters {
  tab: string
  status: string
  sort: string
}

function statusParam(status: string): string | string[] | undefined {
  if (status === 'open') return [...OPEN_RECOMMENDATION_STATUSES]
  if (status === 'closed') return [...CLOSED_RECOMMENDATION_STATUSES]
  if (status === 'all') return undefined
  return status
}

/**
 * Сколько всего рекомендаций каждого приоритета при тех же фильтрах — для чисел
 * в заголовках групп («Высокий приоритет 17 из 18»). Лента идёт по страницам,
 * и одно число строк на странице расходилось бы с подвалом «из 45». Запросы
 * по одной записи — как сводка приоритетов на главной (`PriorityBreakdown`).
 */
function usePriorityTotals(filters: Filters, enabled: boolean): {
  totals: Partial<Record<RecommendationPriority, number>>
  reload: () => void
} {
  const path = (priority: RecommendationPriority) =>
    enabled
      ? `/api/recommendations${buildQuery({
          type: filters.tab === 'all' ? undefined : filters.tab,
          status: statusParam(filters.status),
          priority,
          pageSize: 1,
        })}`
      : null
  const critical = useResource<RecommendationDto[]>(path('CRITICAL'), { keepPreviousData: true })
  const high = useResource<RecommendationDto[]>(path('HIGH'), { keepPreviousData: true })
  const medium = useResource<RecommendationDto[]>(path('MEDIUM'), { keepPreviousData: true })
  const low = useResource<RecommendationDto[]>(path('LOW'), { keepPreviousData: true })
  const all = { CRITICAL: critical, HIGH: high, MEDIUM: medium, LOW: low }
  const totals: Partial<Record<RecommendationPriority, number>> = {}
  for (const priority of PRIORITY_ORDER) {
    const total = all[priority].meta?.total
    if (typeof total === 'number') totals[priority] = total
  }
  return {
    totals,
    reload: () => {
      critical.reload()
      high.reload()
      medium.reload()
      low.reload()
    },
  }
}

/**
 * Рекомендации системы — очередь строк (решение 209), та же система, что
 * «Приоритетные действия» на главной (решение 206).
 *
 * Группы — по приоритету, строка — короткий заголовок с глаголом и «почему»
 * одной строкой, справа одно действие. Щелчок по строке раскрывает
 * обоснование: полное описание, проверки правила, балл, объект, «Отклонить»
 * с основанием, черновик письма и «Подробнее» — боковую панель с условиями
 * правила по живым данным и исходными данными. Без обоснования рекомендация
 * выглядит гаданием, поэтому первая строка раскрыта сразу.
 */
function RecommendationsContent() {
  const user = useCurrentUser()
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const canWork = user.permissions.canWorkAnalytics

  const openedId = searchParams.get('recommendation')
  const [tab, setTab] = useState<string>('all')
  // По умолчанию — открытые: «Новая» и «В работе» (решение 128). «all» — все статусы.
  const [status, setStatus] = useState<string>('open')
  // Приоритет может прийти в адресе — с главной, из сводки «Открытые рекомендации»
  // (ТЗ дизайна 26–29.09, п. 3.5). Неизвестное значение — без фильтра.
  const [priority, setPriority] = useState(() => {
    const fromUrl = searchParams.get('priority')
    return fromUrl && (RECOMMENDATION_PRIORITIES as readonly string[]).includes(fromUrl) ? fromUrl : ''
  })
  // Лента по умолчанию — гибрид «приоритет → балл» (решение 147), порядок держит
  // сценарий показа. «По баллу» — отдельный режим на весь балл (решение 119),
  // самим гибридом не заменяется — выбирает сотрудник.
  const [sort, setSort] = useState<string>(RECOMMENDATION_SORT_MOST_IMPORTANT)
  const [page, setPage] = useState(1)
  // undefined — пользователь ещё ничего не раскрывал (тогда раскрыта первая строка).
  const [choice, setChoice] = useState<string | null | undefined>(undefined)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  // Какая запись и в какой статус сейчас уходит — чтобы крутилась только её кнопка.
  const [pending, setPending] = useState<{ id: string; status: RecommendationStatus } | null>(null)
  // Черновик письма вузу: по нажатию, не при открытии страницы (решение 90).
  const [letter, setLetter] = useState<{ item: RecommendationDto; draft: AiDraftDto | null } | null>(null)

  const byPriority = sort === RECOMMENDATION_SORT_MOST_IMPORTANT
  const path = `/api/recommendations${buildQuery({
    type: tab === 'all' ? undefined : tab,
    status: statusParam(status),
    priority: priority || undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  })}`
  const recommendations = useResource<RecommendationDto[]>(path, { keepPreviousData: true })
  usePageInRange(page, setPage, recommendations.meta)
  const priorityTotals = usePriorityTotals({ tab, status, sort }, byPriority)

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

  const draftLetter = useMutation(async (id: string) => {
    const result = await apiPost<AiDraftDto>(`/api/recommendations/${id}/ai-letter`)
    return result.data
  })

  const rows = recommendations.data ?? []
  const groups = groupRecommendations(rows, byPriority)
  const shown = groups.flatMap((group) => group.items)
  const openId = expandedActionId(shown, choice)
  const openedInList = rows.find((row) => row.id === openedId) ?? null

  /**
   * Рекомендация, на которую ведёт ссылка из ленты уведомлений или с дашборда,
   * может лежать не на текущей странице списка — тогда она запрашивается отдельно.
   * Иначе переход по уведомлению открывал бы пустую панель.
   */
  const openedDirect = useResource<RecommendationDto>(
    openedId && !openedInList ? `/api/recommendations/${openedId}` : null,
  )
  const opened = openedInList ?? openedDirect.data

  function reloadAll() {
    recommendations.reload()
    priorityTotals.reload()
  }

  async function changeStatus(item: RecommendationDto, next: RecommendationStatus, title: string) {
    const result = await update.run({ id: item.id, status: next })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(`${RECOMMENDATION_STATUS_LABELS[next]}: ${title}`)
    reloadAll()
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
    reloadAll()
  }

  function toggle(id: string) {
    if (dismissing && dismissing !== id) cancelDismiss()
    setChoice(openId === id ? null : id)
  }

  async function openLetter(item: RecommendationDto) {
    setLetter({ item, draft: null })
    const result = await draftLetter.run(item.id)
    if (!result.ok) {
      toast.error(result.error.message)
      setLetter(null)
      return
    }
    // Пока писалось, могли открыть письмо по другой задаче — чужой текст не подставляем.
    setLetter((current) => (current?.item.id === item.id ? { item, draft: result.data } : current))
  }

  function closeDrawer() {
    router.replace('/recommendations')
  }

  function changeFilter(apply: () => void) {
    apply()
    setPage(1)
    setChoice(undefined)
    cancelDismiss()
  }

  // «Сбросить фильтры» (решение 128): назад к открытым, любому приоритету, всем типам.
  const hasFilters = status !== 'open' || priority !== '' || tab !== 'all' || sort !== RECOMMENDATION_SORT_MOST_IMPORTANT
  function resetFilters() {
    changeFilter(() => {
      setStatus('open')
      setPriority('')
      setTab('all')
      setSort(RECOMMENDATION_SORT_MOST_IMPORTANT)
    })
  }

  const currentPage = recommendations.meta?.page ?? page

  return (
    <>
      {/* Раньше — «Рекомендации» с кнопкой «Пересобрать» (решение 212): эксперт
          не понимал, что это и зачем жать. Список обновляется сам. */}
      <PageHeader
        title="Список задач"
        description="Что система предлагает сделать: просрочки, застрявшие связки, дефициты навыков. Каждая задача объясняет, почему она появилась."
        meta={<HelpHint text={REFRESH_HINT} />}
      />

      <AiAssistCard
        title="Что сделать сегодня"
        description="Ваши дела по открытым задачам этого списка и проблемным этапам ваших связок — в порядке, который задают правила. Текст пишет ИИ-помощник, если он подключён, иначе — шаблон."
        actionLabel="Что сделать сегодня"
        endpoint="/api/ai/today"
      />

      {user.permissions.canSeeAnalytics && <RecommendationExperiment />}

      <Tabs items={TABS} active={tab} onChange={(key) => changeFilter(() => setTab(key))} />

      <Toolbar actions={hasFilters ? <ResetFilters active onReset={resetFilters} /> : undefined}>
        <ToolbarItem>
          <Select
            label="Статус"
            value={status}
            onValueChange={(value) => changeFilter(() => setStatus(value || 'open'))}
            options={[
              { value: 'open', label: 'Открытые' },
              { value: 'closed', label: 'Закрытые' },
              { value: 'all', label: 'Все статусы' },
              ...RECOMMENDATION_WORKFLOW_STATUSES.map((value) => ({
                value,
                label: RECOMMENDATION_STATUS_LABELS[value],
              })),
            ]}
          />
        </ToolbarItem>
        <ToolbarItem>
          <Select
            label="Приоритет"
            placeholder="Любой приоритет"
            value={priority}
            onValueChange={(value) => changeFilter(() => setPriority(value))}
            options={RECOMMENDATION_PRIORITIES.map((value) => ({
              value,
              label: RECOMMENDATION_PRIORITY_LABELS[value],
            }))}
          />
        </ToolbarItem>
        <ToolbarItem>
          <Select
            label="Порядок ленты"
            value={sort}
            onValueChange={(value) => changeFilter(() => setSort(value || RECOMMENDATION_SORT_MOST_IMPORTANT))}
            options={[
              { value: RECOMMENDATION_SORT_MOST_IMPORTANT, label: 'Сначала важное' },
              { value: RECOMMENDATION_SORT_BY_SCORE, label: 'По баллу' },
            ]}
          />
        </ToolbarItem>
      </Toolbar>
      {sort === RECOMMENDATION_SORT_BY_SCORE && (
        <p className={styles.sortNote}>
          Сверху то, что с наибольшей вероятностью окажется полезным по решениям сотрудников; отложенные защитой от
          перегрузки — в конце. Порядок «сначала важное» (приоритет, при равенстве — балл) не меняется — это отдельный режим.
        </p>
      )}

      <Section>
        {recommendations.isLoading ? (
          <TableSkeleton rows={6} columns={2} />
        ) : recommendations.error ? (
          <ErrorState error={recommendations.error} onRetry={recommendations.reload} />
        ) : rows.length === 0 ? (
          <Card muted>
            <EmptyState
              icon="recommendation"
              title="Задач нет"
              description={
                hasFilters
                  ? 'По выбранным условиям ничего нет. Снимите часть фильтров.'
                  : 'Открытых задач нет: просрочек, застрявших связок и дефицитов навыков система сейчас не видит. Закрытые — в фильтре «Статус».'
              }
              action={hasFilters ? <ResetFilters active onReset={resetFilters} /> : undefined}
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
                  total={group.key === 'score' ? recommendations.meta?.total : priorityTotals.totals[group.key]}
                >
                  {group.items.map((item) => {
                    const summary = summarizeRecommendation(item)
                    const isOpen = openId === item.id
                    const next = primaryTransition(item.status)
                    const isPending = pending?.id === item.id
                    const statusTail =
                      item.status === 'NEW' ? null : RECOMMENDATION_STATUS_LABELS[item.status].toLowerCase()
                    const tail = [statusTail, item.isDeferred ? 'отложена' : null].filter(Boolean).join(', ')
                    const responsible = summary.responsible
                    return (
                      <QueueRow
                        key={item.id}
                        tone={toneOfPriority(item.priority)}
                        title={summary.title}
                        meta={{
                          text: summary.why,
                          // Ответственный — хвостом, как в «Требует внимания»; статус, если не «новая».
                          tail: tail || (responsible ?? undefined),
                          tailShort: tail ? undefined : responsible ? shortPersonName(responsible) : undefined,
                          tailTitle: tail ? undefined : (responsible ?? undefined),
                        }}
                        value={rowValue(item)}
                        label={queueRowLabel([
                          `${RECOMMENDATION_PRIORITY_LABELS[item.priority]} приоритет`,
                          summary.title,
                          summary.why,
                          tail || responsible,
                          isOpen ? 'Свернуть обоснование' : 'Показать обоснование',
                        ])}
                        expanded={isOpen}
                        onToggle={() => toggle(item.id)}
                        action={
                          canWork && next ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={ACTION_ICON[next] ?? 'check'}
                              onClick={() => changeStatus(item, next, summary.title)}
                              isLoading={isPending && pending?.status === next}
                              aria-label={`${RECOMMENDATION_STATUS_ACTIONS[next]}: ${summary.title}`}
                            >
                              {RECOMMENDATION_STATUS_ACTIONS[next]}
                            </Button>
                          ) : undefined
                        }
                        detail={
                          <RecommendationDetail
                            item={item}
                            canWork={canWork}
                            canWrite={user.permissions.canWrite}
                            dismissing={dismissing === item.id}
                            comment={comment}
                            onComment={setComment}
                            onStartDismiss={() => startDismiss(item.id)}
                            onCancelDismiss={cancelDismiss}
                            onSubmitDismiss={() => void submitDismiss(item)}
                            dismissPending={isPending && pending?.status === 'DISMISSED'}
                            refusal={dismissing === item.id ? (update.error?.message ?? null) : null}
                            onLetter={() => void openLetter(item)}
                            letterPending={draftLetter.isPending && letter?.item.id === item.id}
                            moreHref={`/recommendations?recommendation=${item.id}`}
                          />
                        }
                      />
                    )
                  })}
                </QueueGroup>
              ))}
            </Queue>

            <Pagination
              page={currentPage}
              pageSize={recommendations.meta?.pageSize ?? PAGE_SIZE}
              total={recommendations.meta?.total ?? rows.length}
              onPageChange={(next) => {
                setPage(next)
                setChoice(undefined)
                cancelDismiss()
              }}
              nouns={['задача', 'задачи', 'задач']}
            />
          </>
        )}
      </Section>

      {opened && (
        <Drawer isOpen onClose={closeDrawer} title={opened.title} description={opened.description}>
          <div className={styles.panel}>
            <p className={styles.panelLine}>
              {RECOMMENDATION_TYPE_LABELS[opened.type as RecommendationType]}, {RECOMMENDATION_PRIORITY_LABELS[opened.priority].toLowerCase()}{' '}
              приоритет, {RECOMMENDATION_STATUS_LABELS[opened.status].toLowerCase()}
            </p>

            <div className={styles.block}>
              <h3 className={styles.blockLabel}>Почему появилась задача</h3>
              <p className={styles.text}>{opened.justification}</p>
            </div>

            {/* Не только балл и текст обоснования: условия правила по живым данным
                (ТЗ дизайна 26–29.09, п. 4.1). */}
            <div className={styles.block}>
              <h3 className={styles.blockLabel}>Условия правила</h3>
              <WhyRecommended recommendation={opened} />
            </div>

            <div className={styles.block}>
              <h3 className={styles.blockLabel}>Как посчитан балл</h3>
              <RecommendationScore score={opened.score} breakdown={opened.scoreBreakdown} variant="full" />
              {opened.isDeferred && (
                <p className={styles.note}>
                  Отложена защитой от перегрузки: у ответственного много невыполненных задач — запись не удалена
                </p>
              )}
            </div>

            <div className={styles.block}>
              <h3 className={styles.blockLabel}>К чему относится</h3>
              <Link className={styles.target} href={recommendationTargetHref(opened.target)}>
                <Icon name="arrowRight" size={16} />
                <span>{opened.target.label}</span>
              </Link>
            </div>

            {opened.relatedData && (
              <div className={styles.block}>
                <h3 className={styles.blockLabel}>Данные, из которых выведена задача</h3>
                <dl className={styles.facts}>
                  {describeRelatedData(opened.relatedData).map((fact) => (
                    <div key={fact.label} className={styles.fact}>
                      <dt>{fact.label}</dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>
                {/* Исходник правила остаётся под рукой: по нему вывод проверяется дословно. */}
                <details className={styles.source}>
                  <summary>Исходные данные правила</summary>
                  <pre className={styles.data}>{JSON.stringify(opened.relatedData, null, 2)}</pre>
                </details>
              </div>
            )}

            <div className={styles.block}>
              <h3 className={styles.blockLabel}>Служебное</h3>
              <p className={styles.meta}>
                Правило: {opened.ruleKey}
                <br />
                Уверенность: {CONFIDENCE_LABELS[opened.confidence]}
                <br />
                Создана: {formatDate(opened.createdAt)}
                {opened.resolvedAt && (
                  <>
                    <br />
                    Закрыта: {formatDate(opened.resolvedAt)}
                  </>
                )}
              </p>
            </div>
          </div>
        </Drawer>
      )}

      {letter && (
        <Modal
          isOpen
          onClose={() => setLetter(null)}
          title="Черновик письма вузу"
          description={letter.item.title}
          wide
          footer={
            <Button variant="ghost" onClick={() => setLetter(null)}>
              Закрыть
            </Button>
          }
        >
          {letter.draft ? <AiDraftView draft={letter.draft} /> : <AiDraftLoading />}
        </Modal>
      )}
    </>
  )
}

/**
 * Раскрытая строка: полное описание, проверки правила, балл, объект, комментарий
 * при закрытии и действия — «Отклонить» с основанием (прямо здесь, как на главной),
 * черновик письма и «Подробнее» — боковая панель.
 */
function RecommendationDetail({
  item,
  canWork,
  canWrite,
  dismissing,
  comment,
  onComment,
  onStartDismiss,
  onCancelDismiss,
  onSubmitDismiss,
  dismissPending,
  refusal,
  onLetter,
  letterPending,
  moreHref,
}: {
  item: RecommendationDto
  canWork: boolean
  canWrite: boolean
  dismissing: boolean
  comment: string
  onComment: (value: string) => void
  onStartDismiss: () => void
  onCancelDismiss: () => void
  onSubmitDismiss: () => void
  dismissPending: boolean
  refusal: string | null
  onLetter: () => void
  letterPending: boolean
  /** Панель открывается адресом — туда же ведёт ссылка из уведомления. */
  moreHref: string
}) {
  // Письмо — только по открытой задаче: по закрытой писать вузу не о чем.
  const isOpen = item.status !== 'DONE' && item.status !== 'DISMISSED'
  return (
    <div className={styles.detail}>
      <p className={styles.text}>{item.description}</p>

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

      {item.resolutionComment && (
        <p className={styles.resolution}>
          <span className={styles.resolutionLabel}>Основание: </span>
          {item.resolutionComment}
        </p>
      )}

      <RecommendationScore score={item.score} breakdown={item.scoreBreakdown} />
      {item.isDeferred && (
        <p className={styles.note}>Отложена защитой от перегрузки: у ответственного много невыполненных задач.</p>
      )}

      <div className={styles.detailFoot}>
        <Link className={styles.target} href={recommendationTargetHref(item.target)}>
          <Icon name="arrowRight" size={16} />
          <span>{item.target.label}</span>
        </Link>
        <span className={styles.meta}>
          Уверенность {CONFIDENCE_LABELS[item.confidence].toLowerCase()}, создана {formatDate(item.createdAt)}
        </span>
      </div>

      {dismissing ? (
        <form
          className={styles.dismiss}
          onSubmit={(event) => {
            event.preventDefault()
            if (comment.trim()) onSubmitDismiss()
          }}
        >
          <Textarea
            label="Основание"
            hint="Обязательное поле: без него сервер отклонение не примет. Основание сохранится в карточке задачи."
            value={comment}
            onChange={(event) => onComment(event.target.value)}
            maxLength={1000}
            autoFocus
          />
          {refusal && (
            <p className={styles.refusal} role="alert">
              {refusal}
            </p>
          )}
          <div className={styles.detailActions}>
            <Button type="submit" variant="primary" size="sm" disabled={comment.trim().length === 0} isLoading={dismissPending}>
              {RECOMMENDATION_STATUS_ACTIONS.DISMISSED}
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancelDismiss}>
              Отмена
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.detailActions}>
          {canWork && canDismiss(item.status) && (
            <Button variant="ghost" size="sm" icon="close" onClick={onStartDismiss}>
              {RECOMMENDATION_STATUS_ACTIONS.DISMISSED}
            </Button>
          )}
          {canWrite && isOpen && (
            <Button variant="ghost" size="sm" icon="mail" onClick={onLetter} isLoading={letterPending}>
              Черновик письма
            </Button>
          )}
          <Button variant="ghost" size="sm" icon="recommendation" href={moreHref} scroll={false}>
            Подробнее
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Страница читает адрес (`?recommendation=…`), а `useSearchParams` требует
 * границы Suspense: без неё сборка страницы не проходит.
 */
export default function RecommendationsPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={6} columns={2} />}>
      <RecommendationsContent />
    </Suspense>
  )
}
