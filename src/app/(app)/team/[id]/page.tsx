'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import {
  COOPERATION_STATUS_LABELS,
  USER_ROLE_LABELS,
  type AssignmentDto,
  type TeamCooperationDto,
  type TeamMemberProfileDto,
} from '@/shared/contracts'
import { showAllState } from '@/ui/lib/show-all'
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  HelpHint,
  MockBadge,
  PageHeader,
  Skeleton,
  SkeletonLines,
  Tabs,
  buildQuery,
  cooperationHref,
  formatDateTime,
  formatDayMonth,
  formatPercent,
  formatRelative,
  pluralize,
  ROUTES,
  useCurrentUser,
  useResource,
  type Crumb,
  type Resource,
} from '@/ui'
import { AssignmentModal } from '../../AssignmentModal'
import { AssignmentRows } from '../../AssignmentRows'
import { splitByDone } from '../../assignment-view'
import { ChangeResponsibleModal } from '../../ChangeResponsibleModal'
import { LoadBadge, LoadBar, LoadLegend } from '../LoadBar'
import { Section, StageItem } from '../MemberDrawer'
import { actionText, actionWhen, displayRule, noLoadReason, weekLabel } from '../team-view'
import teamStyles from '../team.module.css'
import styles from './profile.module.css'

/**
 * Страница сотрудника (решение 230): всё, что в боковой панели «Команды», одним
 * экраном и тем же расчётом (`GET /api/team/:id/profile`), плюс рабочая почта,
 * поручения в обе стороны и крупный сгенерированный аватар.
 *
 * Права — как у «Команды»: руководитель, администратор и эксперт (только чтение)
 * открывают любого; менеджер, аналитик и наблюдатель — только свою страницу (чужую
 * закрывает охранник каркаса «Раздел недоступен», сервер ответит 403).
 */

const stageNo = (value: number) => `${String(value).padStart(2, '0')}/14`

const MESSENGER_LABELS = { telegram: 'Телеграм', max: 'MAX', vk: 'ВКонтакте' } as const

/** Сделанных поручений на странице — последние; вся история — в журнале. */
/** Поручений на страницу — сколько отдаёт сервер за один запрос; больше — подпись «первые N из M». */
const ASSIGNMENTS_PAGE_SIZE = 100
const DONE_ASSIGNMENTS_SHOWN = 5
const MEETINGS_SHOWN = 8
/**
 * Связок у менеджера десятки: сначала то, что горит (просрочки, неделя), затем
 * первые связки списком и «Показать все» — страница не превращается в реестр.
 */
const COOPERATIONS_SHOWN = 10

type AssignmentSide = 'to' | 'from'

export default function StaffProfilePage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const user = useCurrentUser()
  const profile = useResource<TeamMemberProfileDto>(`/api/team/${encodeURIComponent(id)}/profile`)
  const toMember = useResource<AssignmentDto[]>(
    `/api/assignments${buildQuery({ assigneeId: id, pageSize: ASSIGNMENTS_PAGE_SIZE })}`,
    { keepPreviousData: true },
  )
  const fromMember = useResource<AssignmentDto[]>(
    `/api/assignments${buildQuery({ authorId: id, pageSize: ASSIGNMENTS_PAGE_SIZE })}`,
    { keepPreviousData: true },
  )
  const [side, setSide] = useState<AssignmentSide>('to')
  const [assigning, setAssigning] = useState(false)
  const [transfer, setTransfer] = useState<TeamCooperationDto | null>(null)
  const [showAllCoops, setShowAllCoops] = useState(false)

  const data = profile.data
  const member = data?.member
  const canAssign = user.permissions.canAssignResponsible
  const canAssignTasks = user.permissions.canAssignTasks
  const canSeeTeam = user.permissions.canSeeTeam

  // Своя страница у менеджера: «Команды» у него нет — путь назад ведёт в личный кабинет.
  const breadcrumbs: Crumb[] = canSeeTeam
    ? [{ label: 'Команда', href: ROUTES.team }, { label: member?.fullName ?? 'Сотрудник' }]
    : [{ label: 'Личный кабинет', href: ROUTES.profile }, { label: 'Моя страница сотрудника' }]

  const header = (
    <PageHeader
      breadcrumbs={breadcrumbs}
      title={member?.fullName ?? 'Сотрудник'}
      description={
        member
          ? [member.position, USER_ROLE_LABELS[member.role]].filter(Boolean).join(' · ')
          : 'Связки, сроки, встречи, поручения и последние действия сотрудника'
      }
      help={{ topic: 'team-member' }}
      meta={data?.containsMockData ? <MockBadge /> : undefined}
      actions={
        data && member && canAssignTasks ? (
          <Button variant="primary" icon="plus" onClick={() => setAssigning(true)}>
            Дать поручение
          </Button>
        ) : undefined
      }
    />
  )

  if (profile.isLoading && !data) {
    return (
      <>
        {header}
        <ProfileSkeleton />
      </>
    )
  }

  if (profile.error) {
    return (
      <>
        {header}
        <ErrorState error={profile.error} onRetry={profile.reload} />
      </>
    )
  }

  if (!data || !member) {
    return (
      <>
        {header}
        <Card muted>
          <EmptyState
            title="Сотрудник не найден"
            description="Возможно, учётная запись заблокирована или ссылка устарела."
            action={
              canSeeTeam ? (
                <Button href={ROUTES.team} variant="secondary">
                  Открыть «Команду»
                </Button>
              ) : undefined
            }
          />
        </Card>
      </>
    )
  }

  const ahead = data.weekMeetings.filter((meeting) => meeting.isAhead)
  const pastCount = data.weekMeetings.length - ahead.length
  const now = Date.parse(data.generatedAt)
  const readOnly = !canAssign && !canAssignTasks && canSeeTeam

  return (
    <>
      {header}

      <div className={styles.head}>
        <Card padding="md" className={styles.identity}>
          <figure className={styles.portrait}>
            <Avatar
              name={member.fullName}
              seed={member.id}
              size="xxl"
              label={`Сгенерированный аватар: ${member.fullName}`}
            />
            <figcaption className={styles.portraitCaption}>Сгенерированный аватар</figcaption>
          </figure>

          <div className={styles.identityText}>
            <dl className={styles.contacts}>
              <div>
                <dt>Рабочая почта</dt>
                <dd>
                  {data.contacts.email ? (
                    <a href={`mailto:${data.contacts.email}`} className={styles.mail}>
                      {data.contacts.email}
                    </a>
                  ) : (
                    <span className={styles.quiet}>Видна руководителю, менеджеру и администратору</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Уведомления</dt>
                <dd>
                  {member.messenger ? `SkillLink и ${MESSENGER_LABELS[member.messenger]}` : 'Только в SkillLink'}
                </dd>
              </div>
              <div>
                <dt>Последнее действие</dt>
                <dd className={member.isStale ? teamStyles.signal : undefined}>
                  {member.lastAction
                    ? `${actionText(member.lastAction)} — ${actionWhen(member, now)}`
                    : 'В журнале нет его действий'}
                </dd>
              </div>
            </dl>

            <div className={styles.facts}>
              <span className={styles.fact}>
                <span className={styles.factValue}>{member.activeCooperations}</span>
                <span className={styles.factLabel}>
                  {pluralize(member.activeCooperations, ['связка', 'связки', 'связок'])} в работе
                  {member.universitiesCount > 0 &&
                    `, ${member.universitiesCount} ${pluralize(member.universitiesCount, ['вуз', 'вуза', 'вузов'])}`}
                </span>
              </span>
              <span className={styles.fact}>
                <span className={[styles.factValue, member.overdueStages > 0 ? teamStyles.signal : ''].join(' ')}>
                  {member.overdueStages}
                </span>
                <span className={styles.factLabel}>Просрочено этапов</span>
              </span>
              <span className={styles.fact}>
                <span className={styles.factValue}>{member.meetingsAhead}</span>
                <span className={styles.factLabel}>Встреч впереди на неделе</span>
              </span>
              <span className={styles.fact}>
                <span className={styles.factValue}>{member.assignments.open}</span>
                <span className={styles.factLabel}>
                  Открытых поручений
                  {member.assignments.overdue > 0 && (
                    <span className={teamStyles.signal}>, просрочено {member.assignments.overdue}</span>
                  )}
                </span>
              </span>
              <span className={styles.fact}>
                <span className={styles.factValue}>
                  {formatPercent(member.onTime.percent)}
                </span>
                <span className={styles.factLabel}>
                  Этапов закрыто в срок
                  {member.onTime.closedWithDeadline > 0 &&
                    ` (${member.onTime.closedOnTime} из ${member.onTime.closedWithDeadline})`}
                </span>
              </span>
            </div>
          </div>
        </Card>

        <Card padding="md" className={styles.load}>
          <div className={teamStyles.panelHead}>
            <h2 className={teamStyles.panelTitle}>Нагрузка</h2>
            <HelpHint topic="team" section="roster" />
          </div>
          {member.load ? (
            <>
              <div className={teamStyles.panelLoadTop}>
                <LoadBadge level={member.load.level} />
                <p>
                  <b>{member.load.points}</b> {pluralize(member.load.points, ['балл', 'балла', 'баллов'])} при норме
                  до {data.loadRule.normMax}
                </p>
              </div>
              <LoadBar load={member.load} rule={displayRule(data.loadRule, [member.load])} size="lg" />
              <LoadLegend load={member.load} rule={data.loadRule} />
            </>
          ) : (
            <p className={teamStyles.caption}>{noLoadReason(member)}</p>
          )}
          <p className={teamStyles.more}>
            Тем же расчётом, что в «Команде»: связки в работе + встречи впереди + {data.loadRule.overdueWeight} за
            каждый просроченный этап.
          </p>
        </Card>
      </div>

      {member.isStale && (
        <p className={teamStyles.staleNote}>
          {member.lastAction
            ? `Без движения ${member.daysSinceLastAction} ${pluralize(member.daysSinceLastAction ?? 0, ['день', 'дня', 'дней'])}: последняя запись в журнале — ${formatDateTime(member.lastAction.at)}.`
            : 'В журнале нет ни одного действия этого сотрудника.'}
        </p>
      )}

      {readOnly && (
        <p className={teamStyles.readOnly}>
          Только просмотр: передавать связки и давать поручения могут руководитель и администратор.
        </p>
      )}

      <div className={styles.columns}>
        <div className={styles.main}>
          {data.overdueStages.length > 0 && (
            <Section heading="h2" title="Просрочено" count={data.overdueStages.length}>
              <ul className={teamStyles.stageList}>
                {data.overdueStages.map((stage) => (
                  <StageItem key={stage.stageId} stage={stage} late />
                ))}
              </ul>
            </Section>
          )}

          <Section heading="h2" title={`Этапы на неделе ${weekLabel(data.week)}`} count={data.weekStages.length}>
            {data.weekStages.length > 0 ? (
              <ul className={teamStyles.stageList}>
                {data.weekStages.map((stage) => (
                  <StageItem key={stage.stageId} stage={stage} late={stage.daysOverdue !== null} />
                ))}
              </ul>
            ) : (
              <p className={teamStyles.muted}>Сроков его этапов на этой неделе нет.</p>
            )}
          </Section>

          <Section heading="h2" title="Встречи впереди на неделе" count={ahead.length}>
            {ahead.length > 0 ? (
              <ul className={teamStyles.meetList}>
                {ahead.slice(0, MEETINGS_SHOWN).map((meeting) => (
                  <li key={meeting.id} className={teamStyles.meetItem}>
                    <span className={teamStyles.stageWhen}>{formatDateTime(meeting.date)}</span>
                    {meeting.cooperationId ? (
                      <Link href={cooperationHref(meeting.cooperationId)} className={teamStyles.stageLink}>
                        {meeting.topic}
                      </Link>
                    ) : (
                      <span className={teamStyles.meetTopic}>{meeting.topic}</span>
                    )}
                    <span className={teamStyles.stageWhere}>
                      {[meeting.universityShortName, meeting.role === 'PARTICIPANT' ? 'участник' : 'ведёт']
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={teamStyles.muted}>До конца недели встреч больше нет.</p>
            )}
            {ahead.length > MEETINGS_SHOWN && (
              <p className={teamStyles.more}>Ещё {ahead.length - MEETINGS_SHOWN} — в карточках связок.</p>
            )}
            {pastCount > 0 && (
              <p className={teamStyles.more}>Прошедших встреч на этой неделе: {pastCount}. В нагрузку они не входят.</p>
            )}
          </Section>

          <Section
            heading="h2"
            title="Связки в работе"
            count={data.cooperations.length}
            help={{ topic: 'team', section: 'transfer' }}
          >
            {data.cooperations.length > 0 ? (
              <ul className={styles.coopList}>
                {(showAllCoops ? data.cooperations : data.cooperations.slice(0, COOPERATIONS_SHOWN)).map((coop) => (
                  <CooperationRow
                    key={coop.id}
                    coop={coop}
                    canTransfer={canAssign}
                    onTransfer={() => setTransfer(coop)}
                  />
                ))}
              </ul>
            ) : (
              <p className={teamStyles.muted}>{noLoadReason(member)}</p>
            )}
            {data.cooperations.length > COOPERATIONS_SHOWN && (
              <Button size="sm" variant="ghost" onClick={() => setShowAllCoops((value) => !value)}>
                {showAllCoops ? 'Свернуть' : `Показать все ${data.cooperations.length}`}
              </Button>
            )}
          </Section>
        </div>

        <div className={styles.aside}>
          <Section heading="h2" title="Поручения" help={{ topic: 'assignments', section: 'statuses' }}>
            <Tabs
              items={[
                { key: 'to', label: 'Ему', count: toMember.data ? splitByDone(toMember.data).open.length : undefined },
                {
                  key: 'from',
                  label: 'От него',
                  count: fromMember.data ? splitByDone(fromMember.data).open.length : undefined,
                },
              ]}
              active={side}
              onChange={(key) => setSide(key as AssignmentSide)}
            />
            {side === 'to' ? (
              <AssignmentList resource={toMember} show="author" empty="Поручений ему нет." />
            ) : (
              <AssignmentList resource={fromMember} show="assignee" empty="Поручений он не давал." />
            )}
          </Section>

          <Section heading="h2" title="Последние действия">
            {data.recentActions.length > 0 ? (
              <ul className={teamStyles.actionList}>
                {data.recentActions.map((action, index) => (
                  <li key={`${action.at}-${index}`} className={teamStyles.actionItem}>
                    <span className={teamStyles.stageWhen}>{formatRelative(action.at, now)}</span>
                    <span>{actionText(action)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={teamStyles.muted}>В журнале нет его действий.</p>
            )}
            <p className={teamStyles.more}>
              Здесь — что сделано и когда, без подробностей: полный журнал открыт только администратору.
            </p>
          </Section>
        </div>
      </div>

      {assigning && (
        <AssignmentModal
          members={[member]}
          initialAssigneeId={member.id}
          onClose={(created) => {
            setAssigning(false)
            if (created) {
              toMember.reload()
              fromMember.reload()
              profile.reload()
            }
          }}
        />
      )}

      {transfer && (
        <ChangeResponsibleModal
          title="Передать связку"
          help={{ topic: 'team', section: 'transfer' }}
          description={`${transfer.universityShortName ?? transfer.universityName} → ${transfer.programName}`}
          consequence="Смена попадёт в журнал действий. Ответственные за отдельные этапы не меняются: их просрочки останутся за прежним сотрудником."
          endpoint={`/api/cooperations/${transfer.id}`}
          currentResponsibleId={member.id}
          currentResponsibleName={member.fullName}
          onClose={(changed) => {
            setTransfer(null)
            if (changed) profile.reload()
          }}
        />
      )}
    </>
  )
}

/** Связка в работе: маршрут, текущий этап и его срок; «Передать» — тем, кому можно. */
function CooperationRow({
  coop,
  canTransfer,
  onTransfer,
}: {
  coop: TeamCooperationDto
  canTransfer: boolean
  onTransfer: () => void
}) {
  const route = `${coop.universityShortName ?? coop.universityName} → ${coop.programName}`
  const stage = coop.currentStage
  return (
    <li className={styles.coopItem}>
      <div className={styles.coopText}>
        <Link href={cooperationHref(coop.id)} className={teamStyles.stageLink}>
          {route}
        </Link>
        <span className={teamStyles.stageWhere}>
          {COOPERATION_STATUS_LABELS[coop.status]}
          {stage && (
            <>
              {' · '}
              <span className={teamStyles.stageNo}>{stageNo(stage.stageNumber)}</span> {stage.title}
            </>
          )}
        </span>
      </div>
      <span className={[styles.coopDue, stage?.isOverdue ? teamStyles.signal : ''].filter(Boolean).join(' ')}>
        {stage?.deadline
          ? stage.isOverdue
            ? `срок ${formatDayMonth(stage.deadline)}, просрочен`
            : `срок ${formatDayMonth(stage.deadline)}`
          : 'без срока'}
        {coop.overdueStages > 0 && !stage?.isOverdue && (
          <span className={teamStyles.signal}> · просрочено {coop.overdueStages}</span>
        )}
      </span>
      {canTransfer && (
        <span className={styles.coopAction}>
          <Button size="sm" variant="ghost" onClick={onTransfer} aria-label={`Передать связку ${route}`}>
            Передать
          </Button>
        </span>
      )}
    </li>
  )
}

function AssignmentList({
  resource,
  show,
  empty,
}: {
  resource: Resource<AssignmentDto[]>
  show: 'author' | 'assignee'
  empty: string
}) {
  const items = resource.data ?? []
  const { open, done } = splitByDone(items)
  const truncated = showAllState(items.length, resource.meta?.total ?? items.length, ASSIGNMENTS_PAGE_SIZE, ASSIGNMENTS_PAGE_SIZE)
  if (resource.isLoading && !resource.data) return <SkeletonLines count={3} />
  if (resource.error) return <ErrorState error={resource.error} onRetry={resource.reload} />
  if (items.length === 0) return <p className={teamStyles.muted}>{empty}</p>
  return (
    <div className={styles.assignments}>
      {open.length > 0 ? (
        <AssignmentRows items={open} show={show} />
      ) : (
        <p className={teamStyles.muted}>Открытых поручений нет — всё сделано.</p>
      )}
      {done.length > 0 && (
        <>
          <p className={teamStyles.more}>
            Сделано{done.length > DONE_ASSIGNMENTS_SHOWN ? ` — последние ${DONE_ASSIGNMENTS_SHOWN} из ${done.length}` : ''}
          </p>
          <AssignmentRows items={done.slice(0, DONE_ASSIGNMENTS_SHOWN)} show={show} />
        </>
      )}
      {truncated && <p className={teamStyles.more}>{truncated.note}</p>}
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <div data-skeleton aria-busy="true">
      <span className="visually-hidden">Загружаем страницу сотрудника</span>
      <div className={styles.head}>
        <Card padding="md" className={styles.identity}>
          <Skeleton width="112px" height="112px" />
          <div className={styles.identityText}>
            <SkeletonLines count={3} />
            <Skeleton width="80%" height="40px" />
          </div>
        </Card>
        <Card padding="md" className={styles.load}>
          <SkeletonLines count={4} />
        </Card>
      </div>
      <div className={styles.columns}>
        <div className={styles.main}>
          <SkeletonLines count={8} />
        </div>
        <div className={styles.aside}>
          <SkeletonLines count={6} />
        </div>
      </div>
    </div>
  )
}
