'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  type AuditChainVerifyDto,
  type AuditLogEntryDto,
  type UserDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  DownloadButton,
  EmptyState,
  ResetFilters,
  ErrorState,
  Icon,
  Input,
  Pagination,
  RemoteSelect,
  Select,
  Toolbar,
  ToolbarItem,
  apiGet,
  buildQuery,
  formatDateTime,
  useMutation,
  usePageInRange,
  useResource,
} from '@/ui'
import { Row, RowsSkeleton } from './SettingsRow'
import { describeChainVerify } from './audit-chain-view'
import {
  auditActionLabel,
  auditActorLabel,
  auditObjectHref,
  auditObjectLabel,
  auditPayloadSummary,
  moscowDayEnd,
  moscowDayStart,
} from './audit-view'
import settings from './settings.module.css'
import styles from './admin.module.css'

/** Максимум для «Выгрузить журнал» одним файлом (`AUDIT_EXPORT_MAX_LIMIT` на сервере). */
const AUDIT_EXPORT_LIMIT = 5000

/**
 * Проверка целостности и выгрузка журнала (решение 115/133, экраны — решение 181).
 *
 * «Проверить целостность» — `GET /api/audit/verify`: цепочка хешей и печати,
 * итог — одной фразой (`describeChainVerify`), без хешей на экране.
 *
 * «Выгрузить журнал» — `GET /api/admin/audit/export`: файл для внешней системы
 * контроля (решение 133, п. 9), одним файлом до `AUDIT_EXPORT_LIMIT` последних
 * записей. Эндпоинт постраничный (`after_id`/`limit`) и фильтров списка выше
 * не принимает — фильтры «Сотрудник/Действие/Объект/Период» на эту выгрузку
 * не распространяются, о чём говорит подсказка рядом с кнопкой.
 */
function IntegritySection() {
  const [result, setResult] = useState<AuditChainVerifyDto | null>(null)
  const check = useMutation(async () => {
    const response = await apiGet<AuditChainVerifyDto>('/api/audit/verify')
    return response.data
  })

  async function run() {
    const outcome = await check.run(undefined)
    if (outcome.ok) setResult(outcome.data)
  }

  const caption = check.error
    ? check.error.message
    : result
      ? describeChainVerify(result)
      : 'Пока не проверялась в этом сеансе.'

  return (
    <>
      <Row
        title="Целостность журнала"
        caption={
          result ? (
            <Badge tone={result.ok ? 'success' : 'danger'} withDot>
              {caption}
            </Badge>
          ) : (
            caption
          )
        }
        hint="Проверка сверяет цепочку хешей записей и печати (решение 115): владелец базы не может незаметно изменить или удалить записи журнала."
      >
        <Button variant="secondary" size="sm" icon="refresh" onClick={run} isLoading={check.isPending}>
          Проверить
        </Button>
      </Row>
      <Row
        title="Выгрузка журнала"
        caption={`Файл для внешней системы контроля: до ${AUDIT_EXPORT_LIMIT} последних записей, все поля. Фильтры списка ниже на неё не действуют.`}
      >
        <DownloadButton
          href={`/api/admin/audit/export${buildQuery({ limit: AUDIT_EXPORT_LIMIT })}`}
          fallbackName="skilllink-audit-log.ndjson"
          variant="secondary"
          size="sm"
        >
          Выгрузить журнал
        </DownloadButton>
      </Row>
    </>
  )
}

/**
 * Вкладка «Журнал действий» (раздел 15 ТЗ): кто, что и над чем сделал.
 *
 * Записи — строками, действие словами (AUDIT_ACTION_LABELS), подробности кратко
 * и без идентификаторов (audit-view.ts), ссылка — если объект открывается
 * в интерфейсе. Фильтры — те, что уже умеет `GET /api/audit`.
 */

const PAGE_SIZE = 25

const ACTION_OPTIONS = AUDIT_ACTIONS.map((action) => ({ value: action, label: auditActionLabel(action) }))
const OBJECT_OPTIONS = AUDIT_OBJECT_TYPES.map((type) => ({ value: type, label: auditObjectLabel(type) }))

function EntryRow({ entry }: { entry: AuditLogEntryDto }) {
  const href = auditObjectHref(entry)
  const summary = auditPayloadSummary(entry)
  return (
    <Row
      title={auditActionLabel(entry.action)}
      caption={
        <>
          <span className={styles.time}>{formatDateTime(entry.createdAt)}</span>
          {` · ${auditActorLabel(entry)} · ${auditObjectLabel(entry.objectType)}`}
          {summary && <span className={styles.summary}>{` · ${summary}`}</span>}
        </>
      }
    >
      {href ? (
        <Link className={styles.objectLink} href={href}>
          Открыть
          <Icon name="arrowRight" size={16} />
        </Link>
      ) : undefined}
    </Row>
  )
}

export function AuditSection() {
  const [userId, setUserId] = useState('')
  const [action, setAction] = useState('')
  const [objectType, setObjectType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)

  const entries = useResource<AuditLogEntryDto[]>(
    `/api/audit${buildQuery({
      userId: userId || undefined,
      action: action || undefined,
      objectType: objectType || undefined,
      from: moscowDayStart(from),
      to: moscowDayEnd(to),
      page,
      pageSize: PAGE_SIZE,
    })}`,
    { keepPreviousData: true },
  )
  usePageInRange(page, setPage, entries.meta)

  function changeFilter(apply: () => void) {
    apply()
    setPage(1)
  }

  const hasFilters = userId !== '' || action !== '' || objectType !== '' || from !== '' || to !== ''
  const rows = entries.data ?? []

  function reset() {
    changeFilter(() => {
      setUserId('')
      setAction('')
      setObjectType('')
      setFrom('')
      setTo('')
    })
  }

  function list() {
    if (entries.isLoading) return <RowsSkeleton count={6} />
    if (entries.error) return <ErrorState error={entries.error} onRetry={entries.reload} />
    if (rows.length === 0) {
      return (
        <EmptyState
          icon="clock"
          title="Записей нет"
          description={
            hasFilters ? 'По выбранным условиям действий не найдено. Снимите часть фильтров.' : 'В журнале пока пусто.'
          }
          action={
            hasFilters ? <ResetFilters active onReset={reset} /> : undefined
          }
        />
      )
    }
    return (
      <div className={entries.isRefreshing ? settings.refreshing : undefined}>
        {rows.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </div>
    )
  }

  return (
    <>
      <IntegritySection />

      <div className={styles.filters}>
        <Toolbar
          actions={hasFilters ? <ResetFilters active onReset={reset} /> : undefined}
        >
          <ToolbarItem>
            <RemoteSelect<UserDto>
              label="Сотрудник"
              endpoint="/api/users"
              params={{ includeInactive: 'true' }}
              toOption={(row) => ({ value: row.id, label: row.fullName })}
              searchPlaceholder="ФИО или почта"
              placeholder="Любой сотрудник"
              value={userId}
              onValueChange={(value) => changeFilter(() => setUserId(value))}
            />
          </ToolbarItem>
          <ToolbarItem>
            <Select
              label="Действие"
              placeholder="Любое действие"
              value={action}
              onValueChange={(value) => changeFilter(() => setAction(value))}
              options={ACTION_OPTIONS}
            />
          </ToolbarItem>
          <ToolbarItem>
            <Select
              label="Объект"
              placeholder="Любой объект"
              value={objectType}
              onValueChange={(value) => changeFilter(() => setObjectType(value))}
              options={OBJECT_OPTIONS}
            />
          </ToolbarItem>
          <ToolbarItem>
            <div className={styles.dates}>
              <Input
                label="С даты"
                type="date"
                title="С даты (по Москве)"
                value={from}
                max={to || undefined}
                onChange={(event) => changeFilter(() => setFrom(event.target.value))}
              />
              <Input
                label="По дату"
                type="date"
                title="По дату включительно (по Москве)"
                value={to}
                min={from || undefined}
                onChange={(event) => changeFilter(() => setTo(event.target.value))}
              />
            </div>
          </ToolbarItem>
        </Toolbar>
      </div>

      {list()}

      {rows.length > 0 && entries.meta && (
        <Pagination
          page={entries.meta.page}
          pageSize={entries.meta.pageSize}
          total={entries.meta.total}
          onPageChange={setPage}
          nouns={['запись', 'записи', 'записей']}
        />
      )}
    </>
  )
}
