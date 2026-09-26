'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  INBOUND_LETTER_GROUP_LABELS,
  type InboundLetterDto,
  type InboundLetterListItemDto,
  type InboundLetterStatsDto,
  type UniversityListItemDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  InboundLetterStatusBadge,
  ListTitle,
  NO_DATA,
  PageHeader,
  Pagination,
  Progress,
  RemoteSelect,
  Section,
  Select,
  TableSkeleton,
  Toolbar,
  ToolbarItem,
  ResetFilters,
  apiUpload,
  buildQuery,
  formatDateTime,
  letterHref,
  useCurrentUser,
  useMutation,
  useResource,
  usePageInRange,
  useToast,
  universityShortOption,
  type Column,
} from '@/ui'
import { buildLettersFilterQuery, formatLetterConfidence, letterGroupStatsHint, letterGroupStatsText } from './letters-view'
import { INBOUND_LETTER_GROUP_OPTIONS, INBOUND_LETTER_STATUS_OPTIONS } from './letters-options'
import styles from './letters.module.css'

const PAGE_SIZE = 20

/**
 * Реестр «Письма вузов» (решение 170/171).
 *
 * ADMIN, HEAD и MANAGER читают (право `INBOUND_READ` на сервере — MANAGER видит
 * только письма своих вузов, фильтрует сервер сам); загружать `.eml` и разбирать
 * заново может только `INBOUND_REVIEW` (ADMIN, HEAD) — эксперту и менеджеру
 * кнопка загрузки не показывается вовсе (раздел 5 задачи).
 */
export default function LettersPage() {
  const user = useCurrentUser()
  const router = useRouter()

  const [status, setStatus] = useState('')
  const [group, setGroup] = useState('')
  const [universityId, setUniversityId] = useState('')
  const [sort, setSort] = useState('-receivedAt')
  const [page, setPage] = useState(1)

  const query = buildLettersFilterQuery({
    status,
    group,
    universityId,
    cooperationId: '',
    sort,
    page,
    pageSize: PAGE_SIZE,
  })
  const letters = useResource<InboundLetterListItemDto[]>(`/api/inbound-letters${buildQuery(query)}`, {
    keepPreviousData: true,
  })
  usePageInRange(page, setPage, letters.meta)

  const stats = useResource<InboundLetterStatsDto>('/api/inbound-letters/stats')

  const rows = letters.data ?? []
  const hasFilters = status !== '' || group !== '' || universityId !== ''

  function changeFilter(apply: () => void) {
    apply()
    setPage(1)
  }

  function resetFilters() {
    changeFilter(() => {
      setStatus('')
      setGroup('')
      setUniversityId('')
    })
  }

  const columns: Column<InboundLetterListItemDto>[] = [
    {
      key: 'receivedAt',
      title: 'Дата',
      width: '124px',
      sortField: 'receivedAt',
      sortDescFirst: true,
      render: (row: InboundLetterListItemDto) => (
        <span className={styles.muted}>{formatDateTime(row.receivedAt)}</span>
      ),
    },
    {
      key: 'sender',
      title: 'Отправитель',
      render: (row: InboundLetterListItemDto) => (
        <ListTitle
          title={row.senderName ?? row.senderEmail}
          tooltip={row.senderName ? `${row.senderName} · ${row.senderEmail}` : row.senderEmail}
          subline={[row.senderName ? row.senderEmail : null, row.bodyPreview]}
        />
      ),
    },
    {
      key: 'university',
      title: 'Вуз',
      render: (row: InboundLetterListItemDto) => (
        <span className={styles.cell} title={row.current.universityName ?? undefined}>
          {row.current.universityName ?? NO_DATA}
        </span>
      ),
    },
    {
      key: 'subject',
      title: 'Тема',
      hideInList: true,
      render: (row: InboundLetterListItemDto) => (
        <span className={styles.cell} title={row.subject}>
          {row.subject}
        </span>
      ),
    },
    {
      key: 'group',
      title: 'Группа',
      width: '150px',
      render: (row: InboundLetterListItemDto) =>
        row.current.group ? <Badge tone="accent">{INBOUND_LETTER_GROUP_LABELS[row.current.group]}</Badge> : (
          <span className={styles.muted}>{NO_DATA}</span>
        ),
    },
    {
      key: 'confidence',
      title: 'Уверенность',
      width: '110px',
      render: (row: InboundLetterListItemDto) => (
        <span className={styles.muted}>{formatLetterConfidence(row.current.confidence)}</span>
      ),
    },
    {
      key: 'status',
      title: 'Статус',
      width: '140px',
      sortField: 'status',
      render: (row: InboundLetterListItemDto) => <InboundLetterStatusBadge status={row.status} />,
    },
  ]

  return (
    <>
      <PageHeader
        title="Письма вузов"
        description="Письма вузов как обращения: разбор системы, проверка сотрудником и задание ответственному. Живого почтового ящика нет — демо-письма и загрузка .eml."
        actions={user.permissions.canReviewLetters ? <UploadLetterButton onUploaded={(id) => router.push(letterHref(id))} /> : undefined}
      />

      <Section>
        <Card className={styles.statsCard}>
          {stats.isLoading ? (
            <TableSkeleton rows={2} columns={6} />
          ) : stats.error ? (
            <ErrorState error={stats.error} onRetry={stats.reload} />
          ) : (
            <div className={styles.statsGrid}>
              {(stats.data?.groups ?? []).map((groupStat) => (
                <div key={groupStat.group} className={styles.statsItem} title={letterGroupStatsHint(groupStat)}>
                  <Progress
                    value={groupStat.accuracy === null ? null : Math.round(groupStat.accuracy * 100)}
                    label={letterGroupStatsText(groupStat)}
                  />
                  <span className={styles.statsLabel}>{letterGroupStatsText(groupStat)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Section>

      <Toolbar actions={hasFilters ? <ResetFilters active onReset={resetFilters} /> : undefined}>
        <ToolbarItem>
          <Select
            label="Статус"
            placeholder="Любой статус"
            value={status}
            onValueChange={(value) => changeFilter(() => setStatus(value))}
            options={INBOUND_LETTER_STATUS_OPTIONS}
          />
        </ToolbarItem>
        <ToolbarItem>
          <Select
            label="Группа"
            placeholder="Любая группа"
            value={group}
            onValueChange={(value) => changeFilter(() => setGroup(value))}
            options={INBOUND_LETTER_GROUP_OPTIONS}
          />
        </ToolbarItem>
        <ToolbarItem>
          <RemoteSelect<UniversityListItemDto>
            label="Вуз"
            endpoint="/api/universities"
            params={{ withRating: 'false', sort: 'name' }}
            toOption={universityShortOption}
            placeholder="Любой вуз"
            value={universityId}
            onValueChange={(value) => changeFilter(() => setUniversityId(value))}
          />
        </ToolbarItem>
      </Toolbar>

      <Section>
        <Card padding="none">
          {letters.isLoading ? (
            <TableSkeleton rows={8} columns={7} />
          ) : letters.error ? (
            <ErrorState error={letters.error} onRetry={letters.reload} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="mail"
              title="Писем не найдено"
              description={
                hasFilters
                  ? 'По выбранным условиям ничего нет. Снимите часть фильтров.'
                  : 'Обращений ещё не было. Демо-письма заводятся сидом, а новое — кнопкой «Загрузить письмо (.eml)».'
              }
              action={hasFilters ? <ResetFilters active onReset={resetFilters} /> : undefined}
            />
          ) : (
            <>
              <DataTable
                rows={rows}
                columns={columns}
                getRowKey={(row) => row.id}
                getRowHref={(row) => letterHref(row.id)}
                appearance="list"
                sort={sort}
                onSortChange={(next) => changeFilter(() => setSort(next))}
                isRefreshing={letters.isRefreshing}
                caption="Реестр писем вузов"
              />
              <Pagination
                page={letters.meta?.page ?? page}
                pageSize={letters.meta?.pageSize ?? PAGE_SIZE}
                total={letters.meta?.total ?? rows.length}
                onPageChange={setPage}
                nouns={['письмо', 'письма', 'писем']}
              />
            </>
          )}
        </Card>
      </Section>
    </>
  )
}

/** Загрузка `.eml` — сразу переход в карточку обращения с уже готовым разбором. */
function UploadLetterButton({ onUploaded }: { onUploaded: (id: string) => void }) {
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const upload = useMutation(
    async (file: File) => (await apiUpload<InboundLetterDto>('/api/inbound-letters/upload', file)).data,
  )

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''
    if (!file) return
    const result = await upload.run(file)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Письмо загружено и разобрано')
    onUploaded(result.data.id)
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".eml,message/rfc822"
        className={styles.hiddenInput}
        onChange={onPick}
        tabIndex={-1}
        aria-hidden="true"
      />
      <Button
        variant="primary"
        icon="attach"
        onClick={() => inputRef.current?.click()}
        isLoading={upload.isPending}
      >
        Загрузить письмо (.eml)
      </Button>
    </>
  )
}
