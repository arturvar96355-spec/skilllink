'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import {
  COOPERATION_STATUS_LABELS,
  USER_ROLE_LABELS,
  type TeamCooperationDto,
  type TeamMemberDetailDto,
  type TeamStageRefDto,
} from '@/shared/contracts'
import {
  Button,
  Drawer,
  ErrorState,
  MockBadge,
  SkeletonLines,
  cooperationHref,
  formatDateTime,
  formatDayMonth,
  formatRelative,
  pluralize,
  useResource,
} from '@/ui'
import { ChangeResponsibleModal } from '../ChangeResponsibleModal'
import { LoadBadge, LoadBar, LoadLegend } from './LoadBar'
import { actionText, displayRule, noLoadReason, weekLabel } from './team-view'
import styles from './team.module.css'

const stageNo = (value: number) => `${String(value).padStart(2, '0')}/14`

/** Сколько связок показать сразу: у менеджера их десятки, панель не должна стать реестром. */
const COOPERATIONS_SHOWN = 8
const MEETINGS_SHOWN = 6

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className={styles.panelSection}>
      <h3 className={styles.panelTitle}>
        {title}
        {count !== undefined && <span className={styles.count}>{count}</span>}
      </h3>
      {children}
    </section>
  )
}

function StageItem({ stage, late }: { stage: TeamStageRefDto; late: boolean }) {
  return (
    <li className={styles.stageItem}>
      <span className={late ? styles.signal : styles.stageWhen}>
        {late
          ? stage.daysOverdue === 0
            ? 'срок вышел сегодня'
            : `просрочен на ${stage.daysOverdue} ${pluralize(stage.daysOverdue ?? 0, ['день', 'дня', 'дней'])}`
          : formatDayMonth(stage.deadline)}
      </span>
      <Link href={cooperationHref(stage.cooperationId, stage.stageId)} className={styles.stageLink}>
        <span className={styles.stageNo}>{stageNo(stage.stageNumber)}</span> {stage.title}
      </Link>
      <span className={styles.stageWhere}>
        {stage.universityShortName ?? stage.universityName} → {stage.programName}
      </span>
    </li>
  )
}

/**
 * Боковая панель сотрудника (решение 203). Правило выбора окна — решение 155:
 * посмотреть человека, не уходя со списка, — `Drawer`; действие «Передать связку» —
 * существующее окно `ChangeResponsibleModal` поверх неё.
 */
export function MemberDrawer({
  userId,
  canAssign,
  onClose,
  onChanged,
}: {
  userId: string
  canAssign: boolean
  onClose: () => void
  /** После передачи связки сводка перечитывается: числа строк изменились. */
  onChanged: () => void
}) {
  const detail = useResource<TeamMemberDetailDto>(`/api/team/${userId}`)
  const data = detail.data
  const [transfer, setTransfer] = useState<TeamCooperationDto | null>(null)
  const [showAll, setShowAll] = useState(false)
  const now = Date.now()

  const member = data?.member
  const title = member?.fullName ?? 'Сотрудник'
  const description = member ? (member.position ?? USER_ROLE_LABELS[member.role]) : undefined

  return (
    <>
      <Drawer
        isOpen
        onClose={onClose}
        title={title}
        description={description}
        footer={
          data && !canAssign ? (
            <p className={styles.readOnly}>
              Только просмотр: передавать связки могут руководитель и администратор.
            </p>
          ) : undefined
        }
      >
        {detail.isLoading ? (
          <SkeletonLines count={8} />
        ) : detail.error ? (
          <ErrorState error={detail.error} onRetry={detail.reload} />
        ) : data && member ? (
          <div className={styles.panel}>
            {member.load ? (
              <section className={styles.panelLoad}>
                <div className={styles.panelLoadTop}>
                  <LoadBadge level={member.load.level} />
                  <p>
                    <b>{member.load.points}</b> {pluralize(member.load.points, ['балл', 'балла', 'баллов'])} при норме до{' '}
                    {data.loadRule.normMax}
                  </p>
                </div>
                <LoadBar load={member.load} rule={displayRule(data.loadRule, [member.load])} size="lg" />
                <LoadLegend load={member.load} rule={data.loadRule} />
                {data.containsMockData && <MockBadge />}
              </section>
            ) : (
              <section className={styles.panelLoad}>
                <p className={styles.caption}>{noLoadReason(member)}</p>
              </section>
            )}

            {member.isStale && (
              <p className={styles.staleNote}>
                {member.lastAction
                  ? `Без движения ${member.daysSinceLastAction} ${pluralize(member.daysSinceLastAction ?? 0, ['день', 'дня', 'дней'])}: последняя запись в журнале — ${formatDateTime(member.lastAction.at)}.`
                  : 'В журнале нет ни одного действия этого сотрудника.'}
              </p>
            )}

            {data.overdueStages.length > 0 && (
              <Section title="Просрочено" count={data.overdueStages.length}>
                <ul className={styles.stageList}>
                  {data.overdueStages.map((stage) => (
                    <StageItem key={stage.stageId} stage={stage} late />
                  ))}
                </ul>
              </Section>
            )}

            <Section title={`Этапы на неделе ${weekLabel(data.week)}`} count={data.weekStages.length}>
              {data.weekStages.length > 0 ? (
                <ul className={styles.stageList}>
                  {data.weekStages.map((stage) => (
                    <StageItem key={stage.stageId} stage={stage} late={stage.daysOverdue !== null} />
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>Сроков его этапов на этой неделе нет.</p>
              )}
            </Section>

            <Section title="Встречи на неделе" count={data.weekMeetings.length}>
              {data.weekMeetings.length > 0 ? (
                <>
                  <ul className={styles.meetList}>
                    {data.weekMeetings.slice(0, MEETINGS_SHOWN).map((meeting) => (
                      <li key={meeting.id} className={styles.meetItem}>
                        <span className={styles.stageWhen}>{formatDateTime(meeting.date)}</span>
                        <span className={styles.meetTopic}>{meeting.topic}</span>
                        <span className={styles.stageWhere}>
                          {[meeting.universityShortName, meeting.role === 'PARTICIPANT' ? 'участник' : 'ведёт']
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {data.weekMeetings.length > MEETINGS_SHOWN && (
                    <p className={styles.more}>
                      Ещё {data.weekMeetings.length - MEETINGS_SHOWN} — в его календаре и в карточках связок.
                    </p>
                  )}
                </>
              ) : (
                <p className={styles.muted}>Встреч на этой неделе нет.</p>
              )}
            </Section>

            {data.cooperations.length > 0 && (
              <Section title="Связки в работе" count={data.cooperations.length}>
                <ul className={styles.coopList}>
                  {(showAll ? data.cooperations : data.cooperations.slice(0, COOPERATIONS_SHOWN)).map((coop) => (
                    <li key={coop.id} className={styles.coopItem}>
                      <div className={styles.coopText}>
                        <Link href={cooperationHref(coop.id)} className={styles.stageLink}>
                          {coop.universityShortName ?? coop.universityName} → {coop.programName}
                        </Link>
                        <span className={styles.stageWhere}>
                          {COOPERATION_STATUS_LABELS[coop.status]}
                          {coop.currentStage && ` · ${stageNo(coop.currentStage.stageNumber)} ${coop.currentStage.title}`}
                          {coop.overdueStages > 0 && (
                            <span className={styles.signal}> · просрочено {coop.overdueStages}</span>
                          )}
                        </span>
                      </div>
                      {canAssign && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setTransfer(coop)}
                          aria-label={`Передать связку ${coop.universityShortName ?? coop.universityName} → ${coop.programName}`}
                        >
                          Передать
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {data.cooperations.length > COOPERATIONS_SHOWN && (
                  <Button size="sm" variant="ghost" onClick={() => setShowAll((value) => !value)}>
                    {showAll ? 'Свернуть' : `Показать все ${data.cooperations.length}`}
                  </Button>
                )}
              </Section>
            )}

            <Section title="Последние действия">
              {data.recentActions.length > 0 ? (
                <ul className={styles.actionList}>
                  {data.recentActions.map((action, index) => (
                    <li key={`${action.at}-${index}`} className={styles.actionItem}>
                      <span className={styles.stageWhen}>{formatRelative(action.at, now)}</span>
                      <span>{actionText(action)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>В журнале нет его действий.</p>
              )}
              <p className={styles.more}>
                Здесь — что сделано и когда, без подробностей: полный журнал открыт только администратору.
              </p>
            </Section>
          </div>
        ) : null}
      </Drawer>

      {transfer && member && (
        <ChangeResponsibleModal
          title="Передать связку"
          description={`${transfer.universityShortName ?? transfer.universityName} → ${transfer.programName}`}
          consequence="Смена попадёт в журнал действий. Ответственные за отдельные этапы не меняются: их просрочки останутся за прежним сотрудником."
          endpoint={`/api/cooperations/${transfer.id}`}
          currentResponsibleId={member.id}
          currentResponsibleName={member.fullName}
          onClose={(changed) => {
            setTransfer(null)
            if (changed) {
              detail.reload()
              onChanged()
            }
          }}
        />
      )}
    </>
  )
}
