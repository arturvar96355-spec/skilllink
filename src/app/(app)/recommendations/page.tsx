'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import {
  CONFIDENCE_LABELS,
  RECOMMENDATION_PRIORITIES,
  RECOMMENDATION_PRIORITY_LABELS,
  RECOMMENDATION_SORT_MOST_IMPORTANT,
  RECOMMENDATION_STATUSES,
  RECOMMENDATION_STATUS_LABELS,
  RECOMMENDATION_TYPE_LABELS,
  type RecommendationDto,
  type RecommendationGenerationResultDto,
  type RecommendationStatus,
  type RecommendationType,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  CardsSkeleton,
  Drawer,
  EmptyState,
  ErrorState,
  Icon,
  Modal,
  PageHeader,
  Pagination,
  PriorityBadge,
  RecommendationStatusBadge,
  Section,
  Select,
  Tabs,
  Textarea,
  Toolbar,
  ToolbarItem,
  apiPatch,
  apiPost,
  buildQuery,
  formatDate,
  recommendationTargetHref,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
  usePageInRange,
  type TabItem,
} from '@/ui'
import styles from './recommendations.module.css'

const PAGE_SIZE = 20

const TABS: TabItem[] = [
  { key: 'all', label: 'Все' },
  { key: 'PROGRAM', label: 'Программы' },
  { key: 'UNIVERSITY', label: 'Вузы' },
  { key: 'SKILL', label: 'Навыки' },
  { key: 'ACTION', label: 'Действия' },
]

/** Куда можно перевести рекомендацию из текущего состояния. */
const NEXT_STATUSES: Record<RecommendationStatus, RecommendationStatus[]> = {
  NEW: ['IN_PROGRESS', 'ACCEPTED', 'DISMISSED'],
  IN_PROGRESS: ['DONE', 'ACCEPTED', 'DISMISSED'],
  ACCEPTED: ['DONE', 'DISMISSED'],
  DISMISSED: ['NEW'],
  DONE: [],
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
          <CardsSkeleton count={4} />
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
            <div className={styles.list}>
              {rows.map((item) => (
                <Card key={item.id}>
                  <div className={styles.item}>
                    <div className={styles.itemHead}>
                      <div className={styles.titleBlock}>
                        <span className={styles.title}>{item.title}</span>
                        <span className={styles.description}>{item.description}</span>
                      </div>
                      <div className={styles.badges}>
                        <PriorityBadge priority={item.priority} />
                        <RecommendationStatusBadge status={item.status} />
                        <Badge tone="info">{RECOMMENDATION_TYPE_LABELS[item.type as RecommendationType]}</Badge>
                      </div>
                    </div>

                    <p className={styles.justification}>
                      <Icon name="info" size={18} className={styles.justificationIcon} />
                      <span>{item.justification}</span>
                    </p>

                    {item.resolutionComment && (
                      <p className={styles.resolution}>Комментарий: {item.resolutionComment}</p>
                    )}

                    <div className={styles.footerRow}>
                      <a className={styles.target} href={recommendationTargetHref(item.target)}>
                        <Icon name="arrowRight" size={16} />
                        {item.target.label}
                      </a>
                      <span className={styles.meta}>
                        Уверенность: {CONFIDENCE_LABELS[item.confidence]} · правило {item.ruleKey} ·{' '}
                        {formatDate(item.createdAt)}
                      </span>
                    </div>

                    <div className={styles.actions}>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="info"
                        href={`/recommendations?recommendation=${item.id}`}
                      >
                        Подробности
                      </Button>
                      {user.permissions.canWrite &&
                        NEXT_STATUSES[item.status].map((next) => (
                          <Button
                            key={next}
                            variant={next === 'DISMISSED' ? 'ghost' : 'secondary'}
                            size="sm"
                            onClick={() => changeStatus(item, next)}
                            isLoading={update.isPending}
                          >
                            {RECOMMENDATION_STATUS_LABELS[next]}
                          </Button>
                        ))}
                    </div>
                  </div>
                </Card>
              ))}
            </div>

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
            <div className={styles.badges}>
              <PriorityBadge priority={opened.priority} />
              <RecommendationStatusBadge status={opened.status} />
              <Badge tone="info">{RECOMMENDATION_TYPE_LABELS[opened.type as RecommendationType]}</Badge>
            </div>

            <div className={styles.block}>
              <span className={styles.blockLabel}>Почему система это предлагает</span>
              <p className={styles.description}>{opened.justification}</p>
            </div>

            <div className={styles.block}>
              <span className={styles.blockLabel}>К чему относится</span>
              <a className={styles.target} href={recommendationTargetHref(opened.target)}>
                <Icon name="arrowRight" size={16} />
                {opened.target.label}
              </a>
            </div>

            {opened.relatedData && (
              <div className={styles.block}>
                <span className={styles.blockLabel}>Данные, на которых построено предложение</span>
                {/* Сырые данные правила: их видно целиком, чтобы вывод можно было проверить. */}
                <pre className={styles.data}>{JSON.stringify(opened.relatedData, null, 2)}</pre>
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
    <Suspense fallback={<CardsSkeleton count={4} />}>
      <RecommendationsContent />
    </Suspense>
  )
}
