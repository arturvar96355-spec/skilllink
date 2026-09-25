'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import {
  CONFIDENCE_LABELS,
  RECOMMENDATION_PRIORITIES,
  RECOMMENDATION_PRIORITY_LABELS,
  RECOMMENDATION_SORT_MOST_IMPORTANT,
  RECOMMENDATION_STATUS_ACTIONS,
  RECOMMENDATION_STATUSES,
  RECOMMENDATION_STATUS_LABELS,
  RECOMMENDATION_TRANSITIONS,
  RECOMMENDATION_TYPE_LABELS,
  type AiDraftDto,
  type RecommendationDto,
  type RecommendationGenerationResultDto,
  type RecommendationStatus,
  type RecommendationType,
} from '@/shared/contracts'
import {
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  Icon,
  Modal,
  PageHeader,
  Pagination,
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
  recommendationTargetHref,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
  usePageInRange,
  type TabItem,
} from '@/ui'
import { AiAssistCard, AiDraftLoading, AiDraftView } from '../AiDraft'
import styles from './recommendations.module.css'

const PAGE_SIZE = 20

const TABS: TabItem[] = [
  { key: 'all', label: 'Все' },
  { key: 'PROGRAM', label: 'Программы' },
  { key: 'UNIVERSITY', label: 'Вузы' },
  { key: 'SKILL', label: 'Навыки' },
  { key: 'ACTION', label: 'Действия' },
]

/** Сквозной номер строки на всех страницах списка: 01, 02 … 21. */
function rowNumber(page: number, index: number): string {
  return String((page - 1) * PAGE_SIZE + index + 1).padStart(2, '0')
}

/**
 * Рекомендации системы.
 *
 * У каждой показано обоснование: по какому правилу и по каким данным она
 * построена. Это требование ТЗ и главный ответ на вопрос «почему система
 * это предлагает» — без него рекомендация выглядит гаданием.
 */
function RecommendationsContent() {
  const user = useCurrentUser()
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()

  const openedId = searchParams.get('recommendation')
  const [tab, setTab] = useState<string>('all')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [page, setPage] = useState(1)
  const [resolving, setResolving] = useState<{ item: RecommendationDto; status: RecommendationStatus } | null>(null)
  const [comment, setComment] = useState('')
  // Черновик письма вузу: по нажатию, не при открытии страницы (решение 90).
  const [letter, setLetter] = useState<{ item: RecommendationDto; draft: AiDraftDto | null } | null>(null)

  const path = `/api/recommendations${buildQuery({
    type: tab === 'all' ? undefined : tab,
    status: status || undefined,
    priority: priority || undefined,
    sort: RECOMMENDATION_SORT_MOST_IMPORTANT,
    page,
    pageSize: PAGE_SIZE,
  })}`
  const recommendations = useResource<RecommendationDto[]>(path, { keepPreviousData: true })
  usePageInRange(page, setPage, recommendations.meta)

  const generate = useMutation(async () => {
    const result = await apiPost<RecommendationGenerationResultDto>('/api/recommendations/generate')
    return result.data
  })

  const update = useMutation(
    async (input: { id: string; status: RecommendationStatus; comment?: string }) => {
      const result = await apiPatch<RecommendationDto>(`/api/recommendations/${input.id}`, {
        status: input.status,
        comment: input.comment,
      })
      return result.data
    },
  )

  const draftLetter = useMutation(async (id: string) => {
    const result = await apiPost<AiDraftDto>(`/api/recommendations/${id}/ai-letter`)
    return result.data
  })

  const rows = recommendations.data ?? []
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

  async function onGenerate() {
    const result = await generate.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    const { created, updated, closed } = result.data
    toast.success(`Готово: новых ${created}, обновлено ${updated}, закрыто ${closed}.`)
    recommendations.reload()
  }

  async function changeStatus(item: RecommendationDto, next: RecommendationStatus) {
    // Отклонение без основания сервер не примет — спрашиваем комментарий заранее.
    if (next === 'DISMISSED') {
      setResolving({ item, status: next })
      setComment('')
      return
    }
    const result = await update.run({ id: item.id, status: next })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(`Рекомендация: ${RECOMMENDATION_STATUS_LABELS[next].toLowerCase()}`)
    recommendations.reload()
  }

  async function submitResolution() {
    if (!resolving) return
    const result = await update.run({
      id: resolving.item.id,
      status: resolving.status,
      comment: comment.trim(),
    })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Рекомендация отклонена')
    setResolving(null)
    setComment('')
    recommendations.reload()
  }

  async function openLetter(item: RecommendationDto) {
    setLetter({ item, draft: null })
    const result = await draftLetter.run(item.id)
    if (!result.ok) {
      toast.error(result.error.message)
      setLetter(null)
      return
    }
    // Пока писалось, могли открыть письмо по другой рекомендации — чужой текст не подставляем.
    setLetter((current) => (current?.item.id === item.id ? { item, draft: result.data } : current))
  }

  function closeDrawer() {
    router.replace('/recommendations')
  }

  function changeFilter(apply: () => void) {
    apply()
    setPage(1)
  }

  return (
    <>
      <PageHeader
        title="Рекомендации"
        description="Что система предлагает сделать и почему. Правила разбирают данные системы: сроки, дефициты навыков, состояние связок."
        actions={
          user.permissions.canWrite ? (
            <Button icon="refresh" variant="secondary" onClick={onGenerate} isLoading={generate.isPending}>
              Пересобрать
            </Button>
          ) : undefined
        }
      />

      <AiAssistCard
        title="Что сделать сегодня"
        description="Ваши дела по открытым рекомендациям и проблемным этапам ваших связок — в порядке, который задают правила. Текст пишет ИИ-помощник, если он подключён, иначе — шаблон."
        actionLabel="Что сделать сегодня"
        endpoint="/api/ai/today"
      />

      <Tabs items={TABS} active={tab} onChange={(key) => changeFilter(() => setTab(key))} />

      <Toolbar>
        <ToolbarItem>
          <Select
            label="Статус"
            placeholder="Любой статус"
            value={status}
            onValueChange={(value) => changeFilter(() => setStatus(value))}
            options={RECOMMENDATION_STATUSES.map((value) => ({
              value,
              label: RECOMMENDATION_STATUS_LABELS[value],
            }))}
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
      </Toolbar>

      <Section>
        {recommendations.isLoading ? (
          <TableSkeleton rows={5} columns={3} />
        ) : recommendations.error ? (
          <ErrorState error={recommendations.error} onRetry={recommendations.reload} />
        ) : rows.length === 0 ? (
          <Card muted>
            <EmptyState
              icon="recommendation"
              title="Рекомендаций нет"
              description={
                status || priority || tab !== 'all'
                  ? 'По выбранным условиям ничего нет. Снимите часть фильтров.'
                  : 'Система ещё не собирала предложения или все они закрыты.'
              }
              action={
                user.permissions.canWrite ? (
                  <Button icon="refresh" onClick={onGenerate} isLoading={generate.isPending}>
                    Собрать сейчас
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <>
            {/* Рекомендация — строка, а не карточка (07, раздел 11): номер, суть,
                обоснование и действие читаются одной строкой ленты. */}
            <ol className={styles.rows}>
              {rows.map((item, index) => (
                <li key={item.id} className={styles.row}>
                  <span className={styles.index}>{rowNumber(recommendations.meta?.page ?? page, index)}</span>

                  <div className={styles.body}>
                    <span className={styles.kicker}>
                      {RECOMMENDATION_TYPE_LABELS[item.type as RecommendationType]}
                      <span className={styles.priority} data-priority={item.priority}>
                        {RECOMMENDATION_PRIORITY_LABELS[item.priority]} приоритет
                      </span>
                    </span>
                    <a className={styles.title} href={`/recommendations?recommendation=${item.id}`}>
                      {item.title}
                    </a>
                    <p className={styles.description} title={item.description}>
                      {item.description}
                    </p>

                    {/*
                      Обоснование показывается всегда: без него рекомендация — «машина так решила».
                      В ленте — две строки, полностью — в подсказке и в панели рекомендации.
                    */}
                    <p className={styles.why} title={item.justification}>
                      <span className={styles.whyLabel}>Почему</span>
                      <span className={styles.whyText}>{item.justification}</span>
                    </p>

                    {item.resolutionComment && (
                      <p className={styles.resolution}>Комментарий: {item.resolutionComment}</p>
                    )}

                    <div className={styles.foot}>
                      <a className={styles.target} href={recommendationTargetHref(item.target)}>
                        {item.target.label}
                        <Icon name="arrowRight" size={16} />
                      </a>
                      <span className={styles.meta}>
                        {/* Код правила — в панели рекомендации, в «Служебном»: в ленте он ничего не говорит. */}
                        уверенность {CONFIDENCE_LABELS[item.confidence].toLowerCase()} ·{' '}
                        {formatDate(item.createdAt)}
                      </span>
                    </div>
                  </div>

                  <div className={styles.side}>
                    <span className={styles.status} data-status={item.status}>
                      {RECOMMENDATION_STATUS_LABELS[item.status]}
                    </span>
                    {user.permissions.canWrite && RECOMMENDATION_TRANSITIONS[item.status].length > 0 && (
                      <div className={styles.actions}>
                        {RECOMMENDATION_TRANSITIONS[item.status].map((next) => (
                          <Button
                            key={next}
                            variant={next === 'DISMISSED' ? 'ghost' : 'secondary'}
                            size="sm"
                            onClick={() => changeStatus(item, next)}
                            isLoading={update.isPending}
                          >
                            {RECOMMENDATION_STATUS_ACTIONS[next]}
                          </Button>
                        ))}
                      </div>
                    )}
                    {/* Письмо — только по открытой рекомендации: по закрытой писать вузу не о чем. */}
                    {user.permissions.canWrite && item.status !== 'DONE' && item.status !== 'DISMISSED' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="mail"
                          onClick={() => openLetter(item)}
                          isLoading={draftLetter.isPending && letter?.item.id === item.id}
                        >
                          Черновик письма
                        </Button>
                      )}
                  </div>
                </li>
              ))}
            </ol>

            <Pagination
              page={recommendations.meta?.page ?? page}
              pageSize={recommendations.meta?.pageSize ?? PAGE_SIZE}
              total={recommendations.meta?.total ?? rows.length}
              onPageChange={setPage}
              nouns={['рекомендация', 'рекомендации', 'рекомендаций']}
            />
          </>
        )}
      </Section>

      {opened && (
        <Drawer isOpen onClose={closeDrawer} title={opened.title} description={opened.description}>
          <div className={styles.detail}>
            <span className={styles.kicker}>
              {RECOMMENDATION_TYPE_LABELS[opened.type as RecommendationType]}
              <span className={styles.priority} data-priority={opened.priority}>
                {RECOMMENDATION_PRIORITY_LABELS[opened.priority]} приоритет
              </span>
              <span className={styles.status} data-status={opened.status}>
                {RECOMMENDATION_STATUS_LABELS[opened.status]}
              </span>
            </span>

            <div className={styles.block}>
              <span className={styles.blockLabel}>Почему система это предлагает</span>
              <p className={styles.description}>{opened.justification}</p>
            </div>

            <div className={styles.block}>
              <span className={styles.blockLabel}>К чему относится</span>
              <a className={styles.target} href={recommendationTargetHref(opened.target)}>
                {opened.target.label}
                <Icon name="arrowRight" size={16} />
              </a>
            </div>

            {opened.relatedData && (
              <div className={styles.block}>
                <span className={styles.blockLabel}>Данные, на которых построено предложение</span>
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
              <span className={styles.blockLabel}>Служебное</span>
              <span className={styles.meta}>
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
              </span>
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

      {resolving && (
        <Modal
          isOpen
          onClose={() => setResolving(null)}
          title="Отклонить рекомендацию"
          description="Основание сохранится в карточке: по нему видно, почему предложение не приняли."
          closeOnBackdrop={false}
          footer={
            <>
              <Button variant="ghost" onClick={() => setResolving(null)}>
                Отмена
              </Button>
              <Button
                variant="primary"
                onClick={submitResolution}
                isLoading={update.isPending}
                disabled={comment.trim().length === 0}
              >
                Отклонить
              </Button>
            </>
          }
        >
          <Textarea
            label="Основание"
            hint="Обязательное поле: без него сервер отклонение не примет."
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={1000}
            autoFocus
          />
        </Modal>
      )}
    </>
  )
}

/**
 * Страница читает адрес (`?recommendation=…`), а `useSearchParams` требует
 * границы Suspense: без неё сборка страницы не проходит.
 */
export default function RecommendationsPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={5} columns={3} />}>
      <RecommendationsContent />
    </Suspense>
  )
}
