'use client'

import { useState } from 'react'
import type { SkillDto } from '@/shared/contracts'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  ResetFilters,
  Toolbar,
  ToolbarSearch,
  buildQuery,
  formatCount,
  useDebounced,
  usePageInRange,
  useResource,
} from '@/ui'
import { Row, RowsSkeleton } from './SettingsRow'
import { CreateSkillModal, DeleteSkillModal, EditSkillModal, MergeSkillModal } from './SkillModals'
import settings from './settings.module.css'
import styles from './admin.module.css'

/**
 * «Настройки → Справочник навыков» (решение 107, право ADMIN): `/api/skills`
 * умел добавлять, править, объединять дубли и удалять с самого начала —
 * управлять справочником можно было только через `/api-docs` или curl.
 *
 * Список — та же таблица, что кормит `RemoteSelect` в формах привязки навыка
 * к программе и продукту: правка здесь сразу видна там.
 */

const PAGE_SIZE = 20

export function SkillsSection() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<SkillDto | null>(null)
  const [merging, setMerging] = useState<SkillDto | null>(null)
  const [deleting, setDeleting] = useState<SkillDto | null>(null)

  const query = useDebounced(search.trim(), 300)
  const skills = useResource<SkillDto[]>(
    `/api/skills${buildQuery({ q: query || undefined, sort: 'name', page, pageSize: PAGE_SIZE })}`,
    { keepPreviousData: true },
  )
  usePageInRange(page, setPage, skills.meta)

  function changeFilter(apply: () => void) {
    apply()
    setPage(1)
  }

  function reload() {
    skills.reload()
  }

  const rows = skills.data ?? []
  const hasFilters = query !== ''

  function list() {
    if (skills.isLoading) return <RowsSkeleton count={5} />
    if (skills.error) return <ErrorState error={skills.error} onRetry={skills.reload} />
    if (rows.length === 0) {
      return (
        <EmptyState
          icon="skill"
          title="Ничего не нашлось"
          description={hasFilters ? 'По названию ничего не найдено. Снимите фильтр.' : 'Справочник навыков пуст.'}
          action={hasFilters ? <ResetFilters active onReset={() => changeFilter(() => setSearch(''))} /> : undefined}
        />
      )
    }
    return (
      <div className={skills.isRefreshing ? settings.refreshing : undefined}>
        {rows.map((skill) => (
          <Row
            key={skill.id}
            title={
              <>
                {skill.name}
                <Badge tone="neutral">{skill.category}</Badge>
              </>
            }
            caption={[
              skill.description,
              formatCount(skill.programCount, ['программа', 'программы', 'программ']),
              formatCount(skill.productCount, ['продукт', 'продукта', 'продуктов']),
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            <div className={styles.rowActions}>
              <Button size="sm" variant="ghost" onClick={() => setMerging(skill)}>
                Объединить
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(skill)}>
                Изменить
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleting(skill)}>
                Удалить
              </Button>
            </div>
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
              Добавить навык
            </Button>
          }
        >
          <ToolbarSearch>
            <Input
              label="Поиск"
              hideLabel
              placeholder="Название навыка"
              icon="search"
              value={search}
              onChange={(event) => changeFilter(() => setSearch(event.target.value))}
            />
          </ToolbarSearch>
        </Toolbar>
      </div>

      {list()}

      {rows.length > 0 && skills.meta && (
        <Pagination
          page={skills.meta.page}
          pageSize={skills.meta.pageSize}
          total={skills.meta.total}
          onPageChange={setPage}
          nouns={['навык', 'навыка', 'навыков']}
        />
      )}

      {creating && (
        <CreateSkillModal
          onClose={(created) => {
            setCreating(false)
            if (created) reload()
          }}
        />
      )}
      {editing && (
        <EditSkillModal
          key={editing.id}
          skill={editing}
          onClose={(changed) => {
            setEditing(null)
            if (changed) reload()
          }}
        />
      )}
      {merging && (
        <MergeSkillModal
          key={merging.id}
          skill={merging}
          onClose={(merged) => {
            setMerging(null)
            if (merged) reload()
          }}
        />
      )}
      {deleting && (
        <DeleteSkillModal
          key={deleting.id}
          skill={deleting}
          onClose={(deleted) => {
            setDeleting(null)
            if (deleted) reload()
          }}
        />
      )}
    </>
  )
}
