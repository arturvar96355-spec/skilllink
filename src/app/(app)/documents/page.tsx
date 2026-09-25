'use client'

import Link from 'next/link'
import { Suspense, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  DOCUMENT_STATUSES,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  type CooperationListItemDto,
  type DocumentDto,
  type DocumentLinksDto,
  type DocumentListItemDto,
  type DocumentStatus,
  type DocumentStatusChangeDto,
  type ProgramListItemDto,
  type SigningChecklistEffectDto,
  type UniversityListItemDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  DataTable,
  DocumentStatusBadge,
  Drawer,
  EmptyState,
  ResetFilters,
  ErrorState,
  Icon,
  Input,
  NO_DATA,
  PageHeader,
  Pagination,
  RemoteSelect,
  Section,
  Select,
  SkeletonLines,
  TableSkeleton,
  Textarea,
  Toolbar,
  ToolbarItem,
  ToolbarSearch,
  apiPatch,
  buildQuery,
  cooperationHref,
  cooperationOption,
  documentHref,
  formatDate,
  formatDateTime,
  programHref,
  programWithUniversityOption,
  universityHref,
  universityShortOption,
  useCurrentUser,
  useDebounced,
  useMutation,
  useResource,
  useToast,
  usePageInRange,
  type Column,
  type SelectOption,
  formatPersonShort,
  ListTitle,
} from '@/ui'
import styles from './documents.module.css'

const PAGE_SIZE = 20

/**
 * Жизненный цикл документа.
 *
 * Список повторяет `ALLOWED_DOCUMENT_TRANSITIONS` из
 * `src/modules/documents/documents.rules.ts`: правила модуля серверные, фронт
 * из `@/modules` ничего не импортирует. Здесь он нужен только для того, чтобы
 * не предлагать заведомо невозможный переход — решение всё равно принимает
 * сервер, и его отказ показывается пользователю дословно.
 */
const ALLOWED_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  DRAFT: ['REVIEW', 'ARCHIVED'],
  REVIEW: ['APPROVED', 'REJECTED', 'DRAFT', 'ARCHIVED'],
  APPROVED: ['SIGNED', 'REVIEW', 'ARCHIVED'],
  SIGNED: ['ARCHIVED'],
  REJECTED: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: [],
}

/**
 * Что подпись сделала с чек-листом этапа «Подписание документов» (решение 87) —
 * одной фразой к сообщению о статусе. Молчим, когда сказать нечего: пункты уже
 * отмечены, этап закрыт или связка закрыта.
 */
function signingEffectText(effect: SigningChecklistEffectDto | undefined): string | null {
  if (!effect) return null
  const stage = `этапа ${effect.stageNumber} «Подписание документов»`
  switch (effect.outcome) {
    case 'marked':
      return `Пункты ${stage} отмечены: ${effect.marked}`
    case 'locked':
      return `Пункты ${stage} не отмечены: этап ещё за контрольной точкой`
    case 'pending-documents':
      return `Пункты ${stage} отметятся, когда будут подписаны все договоры по связке`
    default:
      return null
  }
}

/** Отклонение и возврат на доработку сервер без основания не примет. */
function needsComment(from: DocumentStatus, to: DocumentStatus): boolean {
  return to === 'REJECTED' || (from === 'REVIEW' && to === 'DRAFT')
}

const TYPE_OPTIONS: SelectOption[] = DOCUMENT_TYPES.map((value) => ({
  value,
  label: DOCUMENT_TYPE_LABELS[value],
}))

const STATUS_OPTIONS: SelectOption[] = DOCUMENT_STATUSES.map((value) => ({
  value,
  label: DOCUMENT_STATUS_LABELS[value],
}))

export default function DocumentsPage() {
  return (
    // useSearchParams требует границы Suspense: без неё страница не пройдёт сборку.
    <Suspense fallback={<TableSkeleton rows={8} columns={6} />}>
      <DocumentsView />
    </Suspense>
  )
}

/**
 * Реестр документов.
 *
 * Файлы не загружаются и не хранятся: в системе есть ссылка на внешний документ
 * и текст, собранный из шаблона (решение 14). Поэтому здесь нет ни кнопки
 * загрузки, ни столбца с размером файла — их нечем наполнить.
 */
function DocumentsView() {
  const user = useCurrentUser()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [universityId, setUniversityId] = useState('')
  const [programId, setProgramId] = useState('')
  const [cooperationId, setCooperationId] = useState('')
  const [sort, setSort] = useState('-updatedAt')
  const [page, setPage] = useState(1)

  const query = useDebounced(search.trim(), 300)

  const path = `/api/documents${buildQuery({
    q: query.length >= 2 ? query : undefined,
    type: type || undefined,
    status: status || undefined,
    universityId: universityId || undefined,
    programId: programId || undefined,
    cooperationId: cooperationId || undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  })}`
  const documents = useResource<DocumentListItemDto[]>(path, { keepPreviousData: true })
  usePageInRange(page, setPage, documents.meta)

  const rows = documents.data ?? []
  const openedId = params.get('document')

  function changeFilter(apply: () => void) {
    // Смена фильтра возвращает на первую страницу: иначе после сужения выборки
    // человек остаётся на странице, которой больше нет.
    apply()
    setPage(1)
  }

  /**
   * Открытая карточка живёт в адресе, а не в состоянии компонента.
   *
   * На документ ведут `documentHref()` из глобального поиска и ленты
   * уведомлений: ссылка обязана открывать панель у того, кто перешёл по ней
   * извне. Поэтому закрытие убирает параметр, а не прячет панель молча.
   */
  function closeDrawer() {
    const next = new URLSearchParams(params.toString())
    next.delete('document')
    const rest = next.toString()
    router.replace(rest === '' ? pathname : `${pathname}?${rest}`, { scroll: false })
  }

  const columns: Column<DocumentListItemDto>[] = [
    {
      key: 'title',
      title: 'Документ',
      sortField: 'title',
      render: (row) => (
        // Лента: название и пояснение — тип, вуз, версия.
        <ListTitle
          title={row.title}
          tooltip={`${row.title} · ${DOCUMENT_TYPE_LABELS[row.type]}${row.templateKey ? ' · собран из шаблона' : ''}`}
          subline={[
            DOCUMENT_TYPE_LABELS[row.type],
            row.links.universityShortName ?? row.links.universityName,
            `версия ${row.version}`,
            row.templateKey && 'собран из шаблона',
          ]}
        />
      ),
    },
    {
      key: 'status',
      title: 'Статус',
      width: '130px',
      sortField: 'status',
      render: (row) => <DocumentStatusBadge status={row.status} />,
    },
    {
      key: 'links',
      title: 'К чему относится',
      hideInList: true,
      width: '200px',
      render: (row) => <DocumentLinks links={row.links} inline />,
    },
    {
      // Автор — в карточке документа: в реестре его столбец отнимал место
      // у названия, и на проекторе оно сжималось в столбик.
      key: 'responsible',
      title: 'Ответственный',
      width: '130px',
      render: (row) => (
        <span className={styles.person} title={row.responsible?.fullName}>
          {row.responsible ? formatPersonShort(row.responsible.fullName) : NO_DATA}
        </span>
      ),
    },
    {
      key: 'updatedAt',
      title: 'Обновлено',
      width: '124px',
      sortField: 'updatedAt',
      sortDescFirst: true,
      render: (row) => <span className={styles.muted}>{formatDateTime(row.updatedAt)}</span>,
    },
  ]

  const hasFilters =
    search.trim() !== '' ||
    type !== '' ||
    status !== '' ||
    universityId !== '' ||
    programId !== '' ||
    cooperationId !== ''

  // «Сбросить фильтры» (решение 109): все условия разом; открытый документ (?document=) не трогаем.
  function resetFilters() {
    changeFilter(() => {
      setSearch('')
      setType('')
      setStatus('')
      setUniversityId('')
      setProgramId('')
      setCooperationId('')
    })
  }

  return (
    <>
      <PageHeader
        title="Документы"
        description="Договоры, соглашения и приложения по связкам. В системе хранятся реквизиты, ссылка на внешний документ и текст, собранный из шаблона: файлы не загружаются."
      />

      <Toolbar actions={hasFilters ? <ResetFilters active onReset={resetFilters} /> : undefined}>
        <ToolbarSearch>
          <Input
            label="Поиск"
            placeholder="Название документа"
            icon="search"
            value={search}
            onChange={(event) => changeFilter(() => setSearch(event.target.value))}
          />
        </ToolbarSearch>
        <ToolbarItem>
          <Select
            label="Тип"
            placeholder="Любой тип"
            value={type}
            onValueChange={(value) => changeFilter(() => setType(value))}
            options={TYPE_OPTIONS}
          />
        </ToolbarItem>
        <ToolbarItem>
          <Select
            label="Статус"
            placeholder="Любой статус"
            value={status}
            onValueChange={(value) => changeFilter(() => setStatus(value))}
            options={STATUS_OPTIONS}
          />
        </ToolbarItem>
        <ToolbarItem>
          {/* Рейтинг вузов фильтру не нужен, а его расчёт — отдельный проход. */}
          <RemoteSelect<UniversityListItemDto>
            label="Вуз"
            endpoint="/api/universities"
            params={{ withRating: 'false', sort: 'name' }}
            toOption={universityShortOption}
            placeholder="Любой вуз"
            value={universityId}
            onValueChange={(value) =>
              changeFilter(() => {
                setUniversityId(value)
                // Программа и связка принадлежат вузу: после его смены
                // прежний выбор дал бы заведомо пустую выборку.
                setProgramId('')
                setCooperationId('')
              })
            }
          />
        </ToolbarItem>
        <ToolbarItem>
          <RemoteSelect<ProgramListItemDto>
            label="Программа"
            endpoint="/api/programs"
            params={{ universityId: universityId || undefined, sort: 'name' }}
            toOption={
              universityId ? (row) => ({ value: row.id, label: row.name }) : programWithUniversityOption
            }
            placeholder="Любая программа"
            value={programId}
            onValueChange={(value) =>
              changeFilter(() => {
                setProgramId(value)
                setCooperationId('')
              })
            }
          />
        </ToolbarItem>
        <ToolbarItem>
          <RemoteSelect<CooperationListItemDto>
            label="Связка"
            endpoint="/api/cooperations"
            params={{
              universityId: universityId || undefined,
              programId: programId || undefined,
            }}
            toOption={cooperationOption}
            searchPlaceholder="Вуз или программа"
            placeholder="Любая связка"
            value={cooperationId}
            onValueChange={(value) => changeFilter(() => setCooperationId(value))}
          />
        </ToolbarItem>
      </Toolbar>

      <Section>
        <Card padding="none" className={styles.registry}>
          {documents.isLoading ? (
            <TableSkeleton rows={8} columns={6} />
          ) : documents.error ? (
            <ErrorState error={documents.error} onRetry={documents.reload} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="document"
              title="Документы не найдены"
              description={
                hasFilters
                  ? 'По выбранным условиям ничего нет. Снимите часть фильтров.'
                  : 'Ни одного документа ещё не заведено. Пакет по связке собирается на её странице.'
              }
              action={hasFilters ? <ResetFilters active onReset={resetFilters} /> : undefined}
            />
          ) : (
            <>
              <DataTable
                rows={rows}
                columns={columns}
                getRowKey={(row) => row.id}
                getRowHref={(row) => documentHref(row.id)}
                appearance="list"
                selectedKey={openedId}
                sort={sort}
                onSortChange={(next) => changeFilter(() => setSort(next))}
                isRefreshing={documents.isRefreshing}
                caption="Реестр документов"
              />
              <Pagination
                page={documents.meta?.page ?? page}
                pageSize={documents.meta?.pageSize ?? PAGE_SIZE}
                total={documents.meta?.total ?? rows.length}
                onPageChange={setPage}
                nouns={['документ', 'документа', 'документов']}
              />
            </>
          )}
        </Card>
      </Section>

      {openedId && (
        <DocumentDrawer
          // Своё состояние у каждого документа: выбранный статус и комментарий
          // не переносятся на следующий, открытый из поиска поверх панели.
          key={openedId}
          id={openedId}
          canWrite={user.permissions.canWrite}
          onClose={closeDrawer}
          onChanged={documents.reload}
        />
      )}
    </>
  )
}

/** Привязки документа: к вузу, программе и связке ведут обычные ссылки. */
/**
 * К чему относится документ. В строке реестра (`inline`) — одной строкой:
 * вуз кратко, программа, связка; полные названия — в подсказках. В карточке —
 * столбиком, с полными названиями.
 */
function DocumentLinks({ links, inline = false }: { links: DocumentLinksDto; inline?: boolean }) {
  const hasAny = links.universityId || links.programId || links.cooperationId
  if (!hasAny) return <span className={styles.muted}>{NO_DATA}</span>
  const universityLabel = inline
    ? (links.universityShortName ?? links.universityName ?? 'Вуз')
    : (links.universityName ?? 'Вуз')

  return (
    <span className={inline ? styles.linksInline : styles.links}>
      {links.universityId && (
        <Link className={styles.link} href={universityHref(links.universityId)} title={links.universityName ?? undefined}>
          {!inline && <Icon name="university" size={16} />}
          <span className={styles.linkText}>{universityLabel}</span>
        </Link>
      )}
      {links.programId && (
        <Link className={styles.link} href={programHref(links.programId)} title={links.programName ?? undefined}>
          {!inline && <Icon name="program" size={16} />}
          <span className={styles.linkText}>{links.programName ?? 'Программа'}</span>
        </Link>
      )}
      {links.cooperationId && (
        <Link className={styles.link} href={cooperationHref(links.cooperationId)}>
          {!inline && <Icon name="cooperation" size={16} />}
          Связка
        </Link>
      )}
    </span>
  )
}

/**
 * Карточка документа.
 *
 * Открывается панелью, а не отдельной страницей: документ смотрят по ходу
 * работы со списком, и уводить с него ради пяти реквизитов незачем
 * (раздел 24 документа об интерфейсе).
 */
function DocumentDrawer({
  id,
  canWrite,
  onClose,
  onChanged,
}: {
  id: string
  canWrite: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const toast = useToast()
  const detail = useResource<DocumentDto>(`/api/documents/${id}`)
  const [nextStatus, setNextStatus] = useState('')
  const [comment, setComment] = useState('')

  const changeStatus = useMutation(
    async (input: { status: DocumentStatus; comment: string | null }) =>
      (await apiPatch<DocumentStatusChangeDto>(`/api/documents/${id}/status`, input)).data,
  )

  const card = detail.data
  const allowed = card ? ALLOWED_TRANSITIONS[card.status] : []
  const target = nextStatus === '' ? null : (nextStatus as DocumentStatus)
  const commentRequired = card !== null && target !== null && needsComment(card.status, target)

  async function onSubmit() {
    if (!target) return
    const trimmed = comment.trim()
    const result = await changeStatus.run({
      status: target,
      comment: trimmed === '' ? null : trimmed,
    })
    if (!result.ok) {
      // Отказ сервера — нормальный ответ, а не сбой: показываем его текст целиком.
      toast.error(result.error.message)
      return
    }
    const effect = signingEffectText(result.data.stageChecklist)
    toast.success(
      `Статус документа: «${DOCUMENT_STATUS_LABELS[result.data.status]}»` + (effect ? `. ${effect}` : ''),
    )
    setNextStatus('')
    setComment('')
    detail.reload()
    onChanged()
  }

  return (
    <Drawer
      isOpen
      onClose={onClose}
      title={card?.title ?? 'Документ'}
      description={
        card ? `${DOCUMENT_TYPE_LABELS[card.type]} · версия ${card.version}` : undefined
      }
      footer={
        card && canWrite && allowed.length > 0 ? (
          <Button
            variant="primary"
            icon="check"
            onClick={onSubmit}
            disabled={target === null}
            isLoading={changeStatus.isPending}
          >
            Сменить статус
          </Button>
        ) : undefined
      }
    >
      {detail.isLoading ? (
        <SkeletonLines count={6} />
      ) : detail.error ? (
        <ErrorState error={detail.error} onRetry={detail.reload} />
      ) : card ? (
        <div className={styles.drawer}>
          <div className={styles.statusRow}>
            <DocumentStatusBadge status={card.status} />
            {card.templateKey && (
              <Badge tone="info">Шаблон: {card.templateName ?? card.templateKey}</Badge>
            )}
          </div>

          <dl className={styles.facts}>
            <Fact label="Тип" value={DOCUMENT_TYPE_LABELS[card.type]} />
            <Fact label="Версия" value={card.version} />
            <Fact label="Автор" value={card.author?.fullName ?? NO_DATA} />
            <Fact label="Ответственный" value={card.responsible?.fullName ?? NO_DATA} />
            <Fact label="Выдан" value={formatDate(card.issuedAt)} />
            <Fact label="Подписан" value={card.signedAt ? formatDate(card.signedAt) : 'Нет'} />
            <Fact label="Создан" value={formatDateTime(card.createdAt)} />
            <Fact label="Обновлён" value={formatDateTime(card.updatedAt)} />
          </dl>

          <section className={styles.block}>
            <h3 className={styles.blockTitle}>К чему относится</h3>
            <DocumentLinks links={card.links} />
          </section>

          <section className={styles.block}>
            <h3 className={styles.blockTitle}>Ссылка на документ</h3>
            {card.fileReference ? (
              <a
                className={styles.fileLink}
                href={card.fileReference}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="external" size={16} />
                {card.fileReference}
              </a>
            ) : (
              <p className={styles.note}>
                Ссылки нет. Файлы в системе не хранятся — только ссылка на внешний документ
                и текст, собранный из шаблона.
              </p>
            )}
          </section>

          {card.content && (
            <section className={styles.block}>
              <h3 className={styles.blockTitle}>Текст документа</h3>
              <pre className={styles.content}>{card.content}</pre>
            </section>
          )}

          {canWrite && (
            <section className={styles.block}>
              <h3 className={styles.blockTitle}>Смена статуса</h3>
              {allowed.length === 0 ? (
                <p className={styles.note}>
                  Из статуса «{DOCUMENT_STATUS_LABELS[card.status]}» переходов нет: это конечное
                  состояние документа.
                </p>
              ) : (
                <div className={styles.statusForm}>
                  <Select
                    label="Новый статус"
                    placeholder="Выберите статус"
                    value={nextStatus}
                    onValueChange={(value) => setNextStatus(value)}
                    options={allowed.map((value) => ({
                      value,
                      label: DOCUMENT_STATUS_LABELS[value],
                    }))}
                  />
                  <Textarea
                    label="Комментарий"
                    rows={3}
                    required={commentRequired}
                    placeholder={
                      commentRequired ? 'Что нужно исправить' : 'Необязательное пояснение'
                    }
                    hint={
                      commentRequired
                        ? 'Отклонение и возврат на доработку без основания не принимаются'
                        : 'Комментарий попадёт в историю документа'
                    }
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                  />
                </div>
              )}
            </section>
          )}

          <section className={styles.block}>
            <h3 className={styles.blockTitle}>История статусов</h3>
            {card.history.length === 0 ? (
              <p className={styles.note}>Статус ещё ни разу не менялся.</p>
            ) : (
              <ol className={styles.history}>
                {card.history.map((entry) => (
                  <li key={entry.id} className={styles.historyItem}>
                    <span className={styles.historyHead}>
                      <span className={styles.historyTransition}>
                        {entry.fromStatus
                          ? `${DOCUMENT_STATUS_LABELS[entry.fromStatus]} → ${DOCUMENT_STATUS_LABELS[entry.toStatus]}`
                          : DOCUMENT_STATUS_LABELS[entry.toStatus]}
                      </span>
                      <span className={styles.muted}>{formatDateTime(entry.changedAt)}</span>
                    </span>
                    <span className={styles.historyAuthor}>{entry.changedBy.fullName}</span>
                    {entry.comment && <p className={styles.historyComment}>{entry.comment}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      ) : null}
    </Drawer>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>{value}</dd>
    </div>
  )
}
