'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import type { TeamOverviewDto } from '@/shared/contracts'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  MockBadge,
  PageHeader,
  Skeleton,
  TableSkeleton,
  Tabs,
  formatDateTime,
  pluralize,
  useCurrentUser,
  useMediaQuery,
  useResource,
} from '@/ui'
import { AssignmentModal } from '../AssignmentModal'
import { MemberDrawer } from './MemberDrawer'
import { TeamList, TeamTable } from './TeamRoster'
import { TeamSummary } from './TeamSummary'
import { TEAM_TABS, displayRule, parseTab, visibleMembers, weekLabel, type TeamTab } from './team-view'
import styles from './team.module.css'

/**
 * «Команда» (решение 203, вариант A макета): кто что ведёт, у кого горит и кто
 * может взять ещё. Руководитель, администратор и эксперт (только чтение) — остальным
 * раздел закрыт охранником каркаса (`isSectionAllowed`) и сервером (403).
 *
 * Открытый сотрудник живёт в адресе (`?member=<id>`), как продукт в реестре продуктов:
 * ссылку можно переслать, «назад» закрывает панель.
 */
export default function TeamPage() {
  // useSearchParams требует границы Suspense: без неё страница не пройдёт сборку.
  return (
    <Suspense fallback={<TeamSkeleton />}>
      <TeamView />
    </Suspense>
  )
}

function TeamSkeleton() {
  return (
    <div className={styles.page} data-skeleton aria-busy="true">
      <span className="visually-hidden">Загружаем команду</span>
      <Card padding="none" className={styles.summary}>
        {[0, 1, 2].map((index) => (
          <div key={index} className={styles.summaryPart}>
            <Skeleton width="45%" height="14px" />
            <Skeleton width="35%" height="32px" />
            <Skeleton width="80%" height="12px" />
          </div>
        ))}
      </Card>
      <TableSkeleton rows={7} columns={6} />
    </div>
  )
}

function TeamView() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const user = useCurrentUser()
  // Таблица из семи столбцов помещается от 961 px; уже — те же строки блоками,
  // а на телефоне сводка уходит под список (макет A, 390 px).
  const isNarrow = useMediaQuery('(max-width: 960px)')
  const isPhone = useMediaQuery('(max-width: 760px)')

  // Вкладка — в адресе, как и открытый сотрудник: «С просрочками» можно переслать ссылкой.
  const tab = parseTab(searchParams.get('tab'))
  const [query, setQuery] = useState('')
  const [ruleOpen, setRuleOpen] = useState(false)

  const team = useResource<TeamOverviewDto>('/api/team')
  const data = team.data
  const openedId = searchParams.get('member')
  const canAssign = user.permissions.canAssignResponsible
  // Поручения (решение 207): ADMIN и HEAD; эксперту кнопки нет — сервер всё равно ответит 403.
  const canAssignTasks = user.permissions.canAssignTasks
  // Окно «Дать поручение» из шапки.
  const [assignOpen, setAssignOpen] = useState(false)
  const now = Date.now()

  function setParam(key: 'member' | 'tab', value: string | null) {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    const rest = next.toString()
    // Панель и вкладки не добавляют записей в историю: «назад» уводит с экрана, а не листает людей.
    router.replace(rest === '' ? pathname : `${pathname}?${rest}`, { scroll: false })
  }

  const setMember = (id: string | null) => setParam('member', id)
  const setTab = (key: TeamTab) => setParam('tab', key === 'all' ? null : key)

  function closeMember() {
    const id = openedId
    setMember(null)
    // Фокус — обратно на имя сотрудника, с которого открыли панель.
    if (id) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-member-open="${CSS.escape(id)}"]`)?.focus()
      })
    }
  }

  const members = data?.members ?? []
  const shown = visibleMembers(members, tab, query)
  const withLoad = members.filter((member) => member.load !== null).length
  const weekText = data ? weekLabel(data.week) : ''

  const header = (
    <PageHeader
      title="Команда"
      description={
        data
          ? `${members.length} ${pluralize(members.length, ['сотрудник', 'сотрудника', 'сотрудников'])}, ${withLoad} ${pluralize(withLoad, ['ведёт', 'ведут', 'ведут'])} связки · данные на ${formatDateTime(data.generatedAt)}`
          : 'Нагрузка, сроки и последние действия сотрудников'
      }
      meta={data?.containsMockData ? <MockBadge /> : undefined}
      actions={
        <div className={styles.headActions}>
          <div className={styles.search}>
            <Input
              label="Поиск по команде"
              hideLabel
              icon="search"
              type="search"
              placeholder="ФИО, роль или вуз"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
          </div>
          {canAssignTasks && data && members.length > 0 && (
            <Button variant="primary" icon="plus" onClick={() => setAssignOpen(true)}>
              Дать поручение
            </Button>
          )}
        </div>
      }
    />
  )

  if (team.isLoading) {
    return (
      <>
        {header}
        <TeamSkeleton />
      </>
    )
  }

  if (team.error) {
    return (
      <>
        {header}
        <ErrorState error={team.error} onRetry={team.reload} />
      </>
    )
  }

  if (!data || members.length === 0) {
    return (
      <>
        {header}
        <Card muted>
          <EmptyState
            title="В команде пока никого"
            description={
              user.permissions.isAdmin
                ? 'Заведите сотрудника во вкладке «Пользователи» настроек — здесь появятся его связки и нагрузка.'
                : 'Сотрудников заводит администратор. Когда они появятся, здесь будут их связки и нагрузка.'
            }
          />
        </Card>
      </>
    )
  }

  const rule = displayRule(data.loadRule, members.map((member) => member.load))
  const summary = <TeamSummary data={data} rule={rule} canAssign={canAssign} onOpen={setMember} />
  const roster =
    shown.length === 0 ? (
      <Card muted>
        <EmptyState
          title={query.trim() ? 'Никого не нашли' : `«${TEAM_TABS.find((item) => item.key === tab)?.label}» — пусто`}
          description={
            query.trim()
              ? `По запросу «${query.trim()}» никого нет. Ищем по ФИО, роли, должности и вузам, которые ведёт сотрудник.`
              : tab === 'overloaded'
                ? `Перегруженных нет: у всех не больше ${data.loadRule.highMax} баллов.`
                : tab === 'overdue'
                  ? 'Просроченных этапов нет ни у кого.'
                  : `Все работали в системе за последние ${data.staleDays} дней.`
          }
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setTab('all')
                setQuery('')
              }}
            >
              Показать всех
            </Button>
          }
        />
      </Card>
    ) : isNarrow ? (
      <TeamList
        members={shown}
        rule={rule}
        weekText={weekText}
        currentUserId={user.id}
        selectedId={openedId}
        now={now}
        onOpen={setMember}
      />
    ) : (
      <Card padding="none" className={styles.rosterCard}>
        <TeamTable
          members={shown}
          rule={rule}
          weekText={weekText}
          currentUserId={user.id}
          selectedId={openedId}
          now={now}
          onOpen={setMember}
        />
      </Card>
    )

  return (
    <>
      {header}

      <div className={styles.tools}>
        <Tabs
          items={TEAM_TABS.map((item) => ({ key: item.key, label: item.label, count: members.filter(item.test).length }))}
          active={tab}
          onChange={(key) => setTab(key as TeamTab)}
        />
        <button
          type="button"
          className={styles.ruleToggle}
          aria-expanded={ruleOpen}
          aria-controls="team-load-rule"
          onClick={() => setRuleOpen((value) => !value)}
        >
          Как считается нагрузка
        </button>
      </div>

      {ruleOpen && (
        <div id="team-load-rule" className={styles.rule}>
          <p>
            <b>
              Баллы = связки в работе + встречи впереди на неделе + {data.loadRule.overdueWeight} за каждый просроченный
              этап.
            </b>{' '}
            До {data.loadRule.normMax} — норма, {data.loadRule.normMax + 1}–{data.loadRule.highMax} — высокая, больше{' '}
            {data.loadRule.highMax} — перегружен.
          </p>
          <p>
            Просрочка весит втрое: догнать сорванный срок — это письма, звонок и перенос встречи. Связки в работе —
            черновики и активные, как «Активные связи» на главной. Просрочено — текущие начатые этапы после срока, как
            на карточке связки. Встречи впереди — с этого момента до конца недели {weekText}, где сотрудник ведёт встречу
            или приглашён; прошедшие встречи недели уже не нагрузка.
          </p>
        </div>
      )}

      <div className={styles.page}>
        {isPhone ? (
          <>
            {roster}
            {summary}
          </>
        ) : (
          <>
            {summary}
            {roster}
          </>
        )}
        <p className={styles.note}>
          Встречи впереди — с этого момента до конца недели {weekText}. Письма — открытые задания по письмам вузов.
          Поручения — открытые поручения, красным — просроченные из них. Просрочено — текущие начатые
          этапы после срока. Без движения — нет записей в журнале {data.staleDays} дней и дольше.
        </p>
      </div>

      {/* Своя копия панели на каждого сотрудника: у соседнего не мелькнут данные прежнего. */}
      {openedId !== null && (
        <MemberDrawer
          key={openedId}
          userId={openedId}
          canAssign={canAssign}
          canAssignTasks={canAssignTasks}
          members={members}
          onClose={closeMember}
          onChanged={team.reload}
        />
      )}

      {assignOpen && (
        <AssignmentModal
          members={members}
          onClose={(created) => {
            setAssignOpen(false)
            if (created) team.reload()
          }}
        />
      )}
    </>
  )
}
