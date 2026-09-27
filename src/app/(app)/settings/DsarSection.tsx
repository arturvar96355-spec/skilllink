'use client'

import { useState } from 'react'
import {
  DSAR_REQUEST_KINDS,
  DSAR_REQUEST_KIND_LABELS,
  DSAR_REQUEST_STATUSES,
  DSAR_REQUEST_STATUS_LABELS,
  DSAR_SUBJECT_TYPES,
  DSAR_SUBJECT_TYPE_LABELS,
  type DsarRequestDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  DownloadButton,
  EmptyState,
  ErrorState,
  HelpHint,
  Pagination,
  ResetFilters,
  Select,
  Toolbar,
  ToolbarItem,
  buildQuery,
  usePageInRange,
  useResource,
} from '@/ui'
import { CreateDsarRequestModal, EraseSubjectModal } from './DsarModals'
import { Row, RowsSkeleton } from './SettingsRow'
import { dsarChannelCaption, dsarDueCaption, dsarRequestTitle } from './dsar-view'
import styles from './admin.module.css'
import settings from './settings.module.css'

/**
 * Вкладка «Запросы субъектов» (ст. 14, 20, 21 152-ФЗ, решение 116): реестр
 * запросов, регистрация письма (кто/что) и исполнение — выгрузка или
 * обезличивание. Только администратор (право `DSAR_MANAGE`).
 */

const PAGE_SIZE = 20

const STATUS_OPTIONS = DSAR_REQUEST_STATUSES.map((value) => ({ value, label: DSAR_REQUEST_STATUS_LABELS[value] }))
const KIND_OPTIONS = DSAR_REQUEST_KINDS.map((value) => ({ value, label: DSAR_REQUEST_KIND_LABELS[value] }))
const SUBJECT_OPTIONS = DSAR_SUBJECT_TYPES.map((value) => ({ value, label: DSAR_SUBJECT_TYPE_LABELS[value] }))

function exportHref(request: DsarRequestDto): string {
  return request.subjectType === 'USER'
    ? `/api/admin/dsar/users/${request.subjectId}/export`
    : `/api/admin/dsar/contacts/${request.subjectId}/export`
}

function RequestRow({ request, onChanged }: { request: DsarRequestDto; onChanged: () => void }) {
  const [erasing, setErasing] = useState(false)
  const isOpen = request.status === 'OPEN'

  return (
    <Row
      title={dsarRequestTitle(request)}
      caption={
        <>
          {dsarDueCaption(request)} · {dsarChannelCaption(request)} · зарегистрировал {request.requestedBy.fullName}
        </>
      }
    >
      {isOpen ? (
        request.kind === 'EXPORT' ? (
          <DownloadButton
            href={exportHref(request)}
            fallbackName={`skilllink-dsar-${request.subjectType.toLowerCase()}-${request.subjectId}.json`}
            size="sm"
            onDownloaded={onChanged}
          >
            Выгрузить всё о субъекте
          </DownloadButton>
        ) : (
          <Button variant="danger" size="sm" onClick={() => setErasing(true)}>
            Обезличить
          </Button>
        )
      ) : (
        <Badge tone="success" withDot>
          Исполнен
        </Badge>
      )}

      {erasing && (
        <EraseSubjectModal
          request={request}
          onClose={() => setErasing(false)}
          onErased={onChanged}
        />
      )}
    </Row>
  )
}

export function DsarSection() {
  const [status, setStatus] = useState('OPEN')
  const [kind, setKind] = useState('')
  const [subjectType, setSubjectType] = useState('')
  const [page, setPage] = useState(1)
  const [isCreating, setIsCreating] = useState(false)

  const requests = useResource<DsarRequestDto[]>(
    `/api/admin/dsar/requests${buildQuery({
      status: status || undefined,
      kind: kind || undefined,
      subjectType: subjectType || undefined,
      page,
      pageSize: PAGE_SIZE,
    })}`,
    { keepPreviousData: true },
  )
  usePageInRange(page, setPage, requests.meta)

  function changeFilter(apply: () => void) {
    apply()
    setPage(1)
  }

  const hasFilters = status !== 'OPEN' || kind !== '' || subjectType !== ''
  const rows = requests.data ?? []

  function reset() {
    changeFilter(() => {
      setStatus('OPEN')
      setKind('')
      setSubjectType('')
    })
  }

  function list() {
    if (requests.isLoading) return <RowsSkeleton count={4} />
    if (requests.error) return <ErrorState error={requests.error} onRetry={requests.reload} />
    if (rows.length === 0) {
      return (
        <EmptyState
          icon="lock"
          title="Запросов нет"
          description={
            hasFilters
              ? 'По выбранным условиям запросов не найдено. Снимите часть фильтров.'
              : 'Открытых запросов нет. Зарегистрируйте запрос, который пришёл письмом, или выгрузите/обезличьте данные напрямую — так тоже появится запись в реестре.'
          }
          action={hasFilters ? <ResetFilters active onReset={reset} /> : undefined}
        />
      )
    }
    return (
      <div className={requests.isRefreshing ? settings.refreshing : undefined}>
        {rows.map((request) => (
          <RequestRow key={request.id} request={request} onChanged={requests.reload} />
        ))}
      </div>
    )
  }

  return (
    <>
      <div className={styles.filters}>
        <Toolbar
          actions={
            <>
              {hasFilters && <ResetFilters active onReset={reset} />}
              <Button size="sm" onClick={() => setIsCreating(true)}>
                Зарегистрировать запрос
              </Button>
              <HelpHint topic="dsar" section="register" />
            </>
          }
        >
          <ToolbarItem>
            <Select
              label="Статус"
              value={status}
              onValueChange={(value) => changeFilter(() => setStatus(value))}
              options={STATUS_OPTIONS}
            />
          </ToolbarItem>
          <ToolbarItem>
            <Select
              label="Вид"
              placeholder="Любой"
              value={kind}
              onValueChange={(value) => changeFilter(() => setKind(value))}
              options={KIND_OPTIONS}
            />
          </ToolbarItem>
          <ToolbarItem>
            <Select
              label="Кто субъект"
              placeholder="Любой"
              value={subjectType}
              onValueChange={(value) => changeFilter(() => setSubjectType(value))}
              options={SUBJECT_OPTIONS}
            />
          </ToolbarItem>
        </Toolbar>
      </div>

      {list()}

      {rows.length > 0 && requests.meta && (
        <Pagination
          page={requests.meta.page}
          pageSize={requests.meta.pageSize}
          total={requests.meta.total}
          onPageChange={setPage}
          nouns={['запрос', 'запроса', 'запросов']}
        />
      )}

      {isCreating && (
        <CreateDsarRequestModal onClose={() => setIsCreating(false)} onCreated={requests.reload} />
      )}
    </>
  )
}
