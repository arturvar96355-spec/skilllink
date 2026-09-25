'use client'

import { useState } from 'react'
import { USER_ROLES, USER_ROLE_LABELS, type IssuedPasswordDto, type UserDto } from '@/shared/contracts'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  Select,
  Toolbar,
  ToolbarItem,
  ToolbarSearch,
  buildQuery,
  useCurrentUser,
  useDebounced,
  usePageInRange,
  useResource,
} from '@/ui'
import { Row, RowsSkeleton } from './SettingsRow'
import { CreateUserModal, PasswordIssuedModal, UserModal, type IssuedPassword } from './UserModals'
import settings from './settings.module.css'
import styles from './admin.module.css'

/**
 * Вкладка «Пользователи» (ТЗ, п. 5: администратор настраивает пользователей и роли).
 *
 * Сотрудники ИТ-Школы и представители вузов строками: ФИО, роль, почта,
 * должность, вуз, заблокирован ли. Заведение, изменение, блокировка и выдача
 * временного пароля — в окнах (UserModals.tsx). Все проверки — на сервере;
 * интерфейс только заранее предупреждает о том, от чего сервер откажет.
 */

const PAGE_SIZE = 20

const ROLE_OPTIONS = USER_ROLES.map((role) => ({ value: role, label: USER_ROLE_LABELS[role] }))
const STATUS_OPTIONS = [
  { value: 'active', label: 'Действующие' },
  { value: 'blocked', label: 'Заблокированные' },
]

export function UsersSection() {
  const me = useCurrentUser()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<UserDto | null>(null)
  const [issued, setIssued] = useState<IssuedPassword | null>(null)

  const query = useDebounced(search.trim(), 300)
  const users = useResource<UserDto[]>(
    `/api/users${buildQuery({
      q: query || undefined,
      role: role || undefined,
      // Без фильтра — все, включая заблокированных: администратору нужен полный список.
      includeInactive: 'true',
      isActive: status === 'active' ? 'true' : status === 'blocked' ? 'false' : undefined,
      page,
      pageSize: PAGE_SIZE,
    })}`,
    { keepPreviousData: true },
  )
  usePageInRange(page, setPage, users.meta)

  function changeFilter(apply: () => void) {
    apply()
    setPage(1)
  }

  function showIssued(result: IssuedPasswordDto, kind: IssuedPassword['kind']) {
    setCreating(false)
    setEditing(null)
    setIssued({ ...result, kind })
    users.reload()
  }

  const rows = users.data ?? []
  const hasFilters = query !== '' || role !== '' || status !== ''

  function list() {
    if (users.isLoading) return <RowsSkeleton count={5} />
    if (users.error) return <ErrorState error={users.error} onRetry={users.reload} />
    if (rows.length === 0) {
      return (
        <EmptyState
          icon="user"
          title="Никого не нашлось"
          description={hasFilters ? 'По выбранным условиям пользователей нет. Снимите часть фильтров.' : 'Пользователей пока нет.'}
        />
      )
    }
    return (
      <div className={users.isRefreshing ? settings.refreshing : undefined}>
        {rows.map((user) => (
          <Row
            key={user.id}
            title={
              <>
                {user.fullName}
                <span className={styles.badges}>
                  <Badge tone={user.role === 'ADMIN' ? 'accent' : 'neutral'}>{USER_ROLE_LABELS[user.role]}</Badge>
                  {user.id === me.id && <Badge tone="info">это вы</Badge>}
                  {!user.isActive && (
                    <Badge tone="danger" withDot>
                      Заблокирован
                    </Badge>
                  )}
                </span>
              </>
            }
            caption={[user.email, user.position, user.universityName].filter(Boolean).join(' · ')}
          >
            <Button size="sm" variant="secondary" onClick={() => setEditing(user)}>
              Изменить
            </Button>
          </Row>
        ))}
      </div>
    )
  }

  return (
    <>
      <div className={styles.filters}>
        <Toolbar
          actions={
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              Завести пользователя
            </Button>
          }
        >
          <ToolbarSearch>
            <Input
              label="Поиск"
              hideLabel
              placeholder="ФИО или почта"
              icon="search"
              value={search}
              onChange={(event) => changeFilter(() => setSearch(event.target.value))}
            />
          </ToolbarSearch>
          <ToolbarItem>
            <Select
              label="Роль"
              hideLabel
              placeholder="Любая роль"
              value={role}
              onValueChange={(value) => changeFilter(() => setRole(value))}
              options={ROLE_OPTIONS}
            />
          </ToolbarItem>
          <ToolbarItem>
            <Select
              label="Доступ"
              hideLabel
              placeholder="Все учётные записи"
              value={status}
              onValueChange={(value) => changeFilter(() => setStatus(value))}
              options={STATUS_OPTIONS}
            />
          </ToolbarItem>
        </Toolbar>
      </div>

      {list()}

      {rows.length > 0 && users.meta && (
        <Pagination
          page={users.meta.page}
          pageSize={users.meta.pageSize}
          total={users.meta.total}
          onPageChange={setPage}
          nouns={['пользователь', 'пользователя', 'пользователей']}
        />
      )}

      {creating && (
        <CreateUserModal onClose={() => setCreating(false)} onCreated={(result) => showIssued(result, 'create')} />
      )}
      {editing && (
        <UserModal
          // Своё состояние формы у каждого пользователя.
          key={editing.id}
          user={editing}
          onClose={() => setEditing(null)}
          onChanged={users.reload}
          onIssued={(result) => showIssued(result, 'reset')}
        />
      )}
      {issued && <PasswordIssuedModal issued={issued} onClose={() => setIssued(null)} />}
    </>
  )
}
