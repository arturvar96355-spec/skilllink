'use client'

import type { MouseEvent } from 'react'
import { USER_ROLE_LABELS, type TeamLoadRuleDto, type TeamMemberDto } from '@/shared/contracts'
import { Avatar, ScrollArea, formatDayMonth, formatPersonShort, pluralize } from '@/ui'
import { LoadBadge, LoadBar } from './LoadBar'
import { actionText, actionWhen, groupMembers } from './team-view'
import styles from './team.module.css'

interface RosterProps {
  members: TeamMemberDto[]
  rule: TeamLoadRuleDto
  weekText: string
  currentUserId: string
  selectedId: string | null
  now: number
  onOpen: (id: string) => void
}

const stageNo = (value: number) => `${String(value).padStart(2, '0')}/14`

function Person({ member, isYou, onOpen }: { member: TeamMemberDto; isYou: boolean; onOpen: (id: string) => void }) {
  return (
    <div className={styles.person}>
      <Avatar name={member.fullName} size="sm" />
      <div className={styles.personText}>
        <p className={styles.personLine}>
          {/* Имя — настоящая кнопка: строка открывается и с клавиатуры (Tab, Enter). */}
          <button
            type="button"
            className={styles.personName}
            data-member-open={member.id}
            onClick={() => onOpen(member.id)}
            aria-label={`Открыть сотрудника: ${member.fullName}`}
          >
            {formatPersonShort(member.fullName)}
          </button>
          {isYou && <span className={styles.you}>вы</span>}
        </p>
        <p className={styles.personRole}>{member.position ?? USER_ROLE_LABELS[member.role]}</p>
      </div>
    </div>
  )
}

function LastAction({ member, now }: { member: TeamMemberDto; now: number }) {
  if (!member.lastAction) {
    return (
      <p className={styles.last}>
        <span className={[styles.lastWhen, styles.stale].join(' ')}>В журнале нет его действий</span>
      </p>
    )
  }
  return (
    <p className={styles.last}>
      <span className={styles.lastWhat} title={actionText(member.lastAction)}>
        {actionText(member.lastAction)}
      </span>
      <span className={[styles.lastWhen, member.isStale ? styles.stale : ''].filter(Boolean).join(' ')}>
        {actionWhen(member, now)}
      </span>
    </p>
  )
}

/** Поручения (решение 207): открытые числом, просроченные из них — красным под числом. */
function Assignments({ member }: { member: TeamMemberDto }) {
  const { open, overdue } = member.assignments
  if (open === 0) return <span className={styles.zero}>0</span>
  return (
    <>
      {open}
      {overdue > 0 && <span className={[styles.numNote, styles.signal].join(' ')}>просрочено {overdue}</span>}
    </>
  )
}

function Overdue({ value }: { value: number }) {
  return value > 0 ? <span className={styles.signal}>{value}</span> : <span className={styles.zero}>0</span>
}

/** Встречи впереди — они идут в нагрузку; прошедшие на неделе — мелко под числом. */
function MeetingsAhead({ member }: { member: TeamMemberDto }) {
  const past = member.meetingsThisWeek - member.meetingsAhead
  return (
    <>
      {member.meetingsAhead > 0 ? member.meetingsAhead : <span className={styles.zero}>0</span>}
      {past > 0 && <span className={styles.numNote}>прошло {past}</span>}
    </>
  )
}

function Nearest({ member }: { member: TeamMemberDto }) {
  const next = member.nearestDeadline
  if (!next) return <span className={styles.muted}>Сроков впереди нет</span>
  return (
    <>
      <p className={styles.value2}>
        {formatDayMonth(next.deadline)} · {next.universityShortName ?? next.universityName}
      </p>
      <p className={styles.caption} title={`${next.title} — ${next.programName}`}>
        <span className={styles.stageNo}>{stageNo(next.stageNumber)}</span> {next.title}
      </p>
    </>
  )
}

/** Щелчок по любому месту строки открывает панель; кнопки и ссылки внутри работают сами. */
function rowClick(id: string, onOpen: (id: string) => void) {
  return (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, a')) return
    onOpen(id)
  }
}

/**
 * Таблица команды (вариант A макета): две группы — «Ведут связки» по убыванию
 * нагрузки и «Не ведут связки». Строка открывает боковую панель: щелчок по строке,
 * Enter на имени. Слева у строки при наведении и фокусе — полоска «ты здесь».
 */
export function TeamTable({ members, rule, weekText, currentUserId, selectedId, now, onOpen }: RosterProps) {
  const { owners, others } = groupMembers(members)

  const row = (member: TeamMemberDto) => {
    const load = member.load
    return (
      <tr
        key={member.id}
        className={[styles.row, member.id === selectedId ? styles.rowSelected : ''].filter(Boolean).join(' ')}
        onClick={rowClick(member.id, onOpen)}
        aria-current={member.id === selectedId ? 'true' : undefined}
      >
        <td className={styles.cellPerson}>
          <Person member={member} isYou={member.id === currentUserId} onOpen={onOpen} />
          <LastAction member={member} now={now} />
        </td>
        {load ? (
          <>
            <td>
              <p className={styles.value}>
                <b>{member.activeCooperations}</b>{' '}
                <span className={styles.unit}>
                  в {member.universitiesCount} {pluralize(member.universitiesCount, ['вузе', 'вузах', 'вузах'])}
                </span>
              </p>
              <p className={styles.caption} title={member.universities.join(', ')}>
                {member.universities.join(', ')}
              </p>
            </td>
            <td>
              <Nearest member={member} />
            </td>
          </>
        ) : (
          <td colSpan={2} className={styles.none}>
            Связки не ведёт
          </td>
        )}
        <td className={styles.num}>
          <Overdue value={member.overdueStages} />
        </td>
        <td className={styles.num}>
          <MeetingsAhead member={member} />
        </td>
        <td className={styles.num}>
          {member.openLetterTasks > 0 ? member.openLetterTasks : <span className={styles.zero}>0</span>}
        </td>
        <td className={styles.num}>
          <Assignments member={member} />
        </td>
        <td>
          {load ? (
            <div className={styles.loadCell}>
              <div className={styles.loadTop}>
                <LoadBadge level={load.level} />
                <span className={styles.loadNumber}>{load.points}</span>
              </div>
              <LoadBar load={load} rule={rule} />
            </div>
          ) : (
            <span className={styles.zero}>—</span>
          )}
        </td>
      </tr>
    )
  }

  const group = (title: string, list: TeamMemberDto[]) =>
    list.length > 0 && (
      <tbody>
        <tr className={styles.groupRow}>
          <th colSpan={8} scope="colgroup">
            {title}
            <span className={styles.count}>{list.length}</span>
          </th>
        </tr>
        {list.map(row)}
      </tbody>
    )

  return (
    <ScrollArea className={styles.tableWrap} label="Сотрудники команды">
      <table className={styles.table}>
        <caption className="visually-hidden">
          Сотрудники: связки в работе, ближайший срок, просрочки, встречи, письма, поручения и нагрузка
        </caption>
        <colgroup>
          <col style={{ width: '25%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '17%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '11%' }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Сотрудник и последнее действие</th>
            <th scope="col">Связки в работе</th>
            <th scope="col">Ближайший срок</th>
            <th scope="col" className={styles.num} title="Текущие начатые этапы после срока">
              Просрочено
            </th>
            <th
              scope="col"
              className={styles.num}
              title={`Встречи впереди — с этого момента до конца недели ${weekText}; прошедшие в нагрузку не идут`}
            >
              Встречи впереди
            </th>
            <th scope="col" className={styles.num} title="Открытые задания по письмам вузов">
              Письма
            </th>
            <th scope="col" className={styles.num} title="Открытые поручения («Новое» и «В работе»); красным — сколько из них просрочено">
              Поручения
            </th>
            <th scope="col">Нагрузка</th>
          </tr>
        </thead>
        {group('Ведут связки', owners)}
        {group('Не ведут связки', others)}
      </table>
    </ScrollArea>
  )
}

/** Строка поручений в блоке телефона (макет A, 390 px): только если они есть. */
function AssignmentsLine({ member }: { member: TeamMemberDto }) {
  const { open, overdue } = member.assignments
  if (open === 0) return null
  return (
    <p className={styles.blockQuiet}>
      <span>
        Поручения: {open} {pluralize(open, ['открытое', 'открытых', 'открытых'])}
      </span>
      {overdue > 0 && <span className={styles.signal}>просрочено {overdue}</span>}
    </p>
  )
}

/** Телефон: та же таблица — списком блоков (макет A, 390 px). */
export function TeamList({ members, rule, currentUserId, selectedId, now, onOpen }: RosterProps) {
  const { owners, others } = groupMembers(members)

  const item = (member: TeamMemberDto) => {
    const load = member.load
    return (
      <li
        key={member.id}
        className={[styles.block, member.id === selectedId ? styles.rowSelected : ''].filter(Boolean).join(' ')}
        onClick={rowClick(member.id, onOpen)}
      >
        <div className={styles.blockHead}>
          <Person member={member} isYou={member.id === currentUserId} onOpen={onOpen} />
          {load && <LoadBadge level={load.level} />}
        </div>
        {load ? (
          <>
            <div className={styles.blockBar}>
              <LoadBar load={load} rule={rule} />
              <span className={styles.loadNumber}>{load.points}</span>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>Связки</dt>
                <dd>
                  <b>{member.activeCooperations}</b> <span>{member.universities.slice(0, 2).join(', ')}</span>
                </dd>
              </div>
              <div>
                <dt>Просрочено</dt>
                <dd>
                  <Overdue value={member.overdueStages} />
                </dd>
              </div>
              <div>
                <dt>Ближайший срок</dt>
                <dd>
                  {member.nearestDeadline ? (
                    <>
                      {formatDayMonth(member.nearestDeadline.deadline)}{' '}
                      <span>
                        {stageNo(member.nearestDeadline.stageNumber)} ·{' '}
                        {member.nearestDeadline.universityShortName ?? member.nearestDeadline.universityName}
                      </span>
                    </>
                  ) : (
                    <span>впереди нет</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Встречи впереди · письма</dt>
                <dd>
                  {member.meetingsAhead} · {member.openLetterTasks}
                </dd>
              </div>
            </dl>
            <AssignmentsLine member={member} />
          </>
        ) : (
          <p className={styles.blockQuiet}>
            <span>Связки не ведёт</span>
            {member.meetingsAhead > 0 && (
              <span>
                {member.meetingsAhead} {pluralize(member.meetingsAhead, ['встреча', 'встречи', 'встреч'])} впереди
              </span>
            )}
            {member.overdueStages > 0 && <span className={styles.signal}>просрочено {member.overdueStages}</span>}
          </p>
        )}
        {!load && <AssignmentsLine member={member} />}
        <LastAction member={member} now={now} />
      </li>
    )
  }

  const section = (title: string, list: TeamMemberDto[]) =>
    list.length > 0 && (
      <section className={styles.listSection}>
        <h2 className={styles.groupTitle}>
          {title}
          <span className={styles.count}>{list.length}</span>
        </h2>
        <ul className={styles.list}>{list.map(item)}</ul>
      </section>
    )

  return (
    <div className={styles.listWrap}>
      {section('Ведут связки', owners)}
      {section('Не ведут связки', others)}
    </div>
  )
}
