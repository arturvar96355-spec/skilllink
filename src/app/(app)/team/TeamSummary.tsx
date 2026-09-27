import type { TeamLoadRuleDto, TeamMemberDto, TeamOverviewDto } from '@/shared/contracts'
import { Button, Card, NO_DATA, formatNumber, formatPercent, formatPersonShort, pluralize } from '@/ui'
import { levelLabel, points, scalePosition } from './team-view'
import styles from './team.module.css'

/**
 * Сводка команды (вариант A: полоса над таблицей из трёх частей в одной карточке).
 * «Этапы в срок» — то же число, что на главной: сервер считает его по той же выборке.
 */
export function TeamSummary({
  data,
  rule,
  canAssign,
  onOpen,
}: {
  data: TeamOverviewDto
  /** Правило с шкалой экрана (`displayRule`): та же, что у полос в таблице. */
  rule: TeamLoadRuleDto
  canAssign: boolean
  onOpen: (id: string) => void
}) {
  const { summary } = data
  const owners = data.members
    .filter((member): member is TeamMemberDto & { load: NonNullable<TeamMemberDto['load']> } => member.load !== null)
    .sort((a, b) => a.load.points - b.load.points)
  const heaviest = owners.at(-1) ?? null
  const lightest = owners[0] ?? null
  const free = summary.available[0] ?? null
  const average = summary.averageLoad

  return (
    <Card padding="none" className={styles.summary}>
      <section className={styles.summaryPart} aria-labelledby="team-avg">
        <h2 id="team-avg" className={styles.summaryTitle}>
          Средняя нагрузка
        </h2>
        <p className={styles.big}>
          {average === null ? NO_DATA : average}
          {average !== null && <span> {pluralize(average, ['балл', 'балла', 'баллов'])}</span>}
        </p>
        <p className={styles.caption}>
          {summary.loadMembers > 0
            ? `у ${summary.loadMembers} ${pluralize(summary.loadMembers, ['сотрудника', 'сотрудников', 'сотрудников'])} со связками · норма до ${rule.normMax}`
            : 'Связки никто не ведёт'}
          {average !== null && average > rule.normMax ? `, выше на ${average - rule.normMax}` : ''}
        </p>
        {owners.length > 0 && (
          <>
            <div
              className={styles.scale}
              role="img"
              aria-label={`${owners.map((member) => `${formatPersonShort(member.fullName)} — ${member.load.points}`).join(', ')}; норма до ${rule.normMax}, перегрузка после ${rule.highMax}`}
            >
              <span className={styles.scaleLine} />
              <span
                className={styles.scaleHigh}
                style={{ left: `${scalePosition(rule.normMax, rule)}%`, width: `${scalePosition(rule.highMax, rule) - scalePosition(rule.normMax, rule)}%` }}
              />
              <span className={styles.scaleOver} style={{ left: `${scalePosition(rule.highMax, rule)}%` }} />
              {[rule.normMax, rule.highMax].map((value) => (
                <span key={value} className={styles.scaleTick} style={{ left: `${scalePosition(value, rule)}%` }}>
                  <span>{value}</span>
                </span>
              ))}
              {owners.map((member) => (
                <span
                  key={member.id}
                  className={styles.scaleDot}
                  data-level={member.load.level}
                  style={{ left: `${scalePosition(member.load.points, rule)}%` }}
                />
              ))}
            </div>
            <ul className={styles.scaleLegend}>
              {owners
                .slice()
                .reverse()
                .map((member) => (
                  <li key={member.id}>
                    <i className={styles.scaleKey} data-level={member.load.level} aria-hidden="true" />
                    {formatPersonShort(member.fullName).split(' ')[0]}
                    <b>{member.load.points}</b>
                  </li>
                ))}
            </ul>
          </>
        )}
      </section>

      <section className={styles.summaryPart} aria-labelledby="team-ontime">
        <h2 id="team-ontime" className={styles.summaryTitle}>
          Этапы в срок
        </h2>
        <p className={styles.big}>{formatPercent(summary.stagesOnTime.percent)}</p>
        <p className={styles.caption}>
          {summary.stagesOnTime.closedWithDeadline > 0
            ? `${formatNumber(summary.stagesOnTime.closedOnTime)} из ${formatNumber(summary.stagesOnTime.closedWithDeadline)} закрытых этапов, как на главной`
            : 'Закрытых этапов со сроком ещё нет'}
        </p>
        {owners.length > 0 && (
          <ul className={styles.split}>
            {owners
              .slice()
              .reverse()
              .map((member) => (
                <li key={member.id}>
                  <span>{formatPersonShort(member.fullName)}</span>
                  <b>{formatPercent(member.onTime.percent)}</b>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className={styles.summaryPart} aria-labelledby="team-free">
        <h2 id="team-free" className={styles.summaryTitle}>
          Кто может взять связку
        </h2>
        {free ? (
          <>
            <p className={styles.who}>{formatPersonShort(free.fullName)}</p>
            <p className={styles.caption}>
              {points(free.points)} · запас {free.capacity} до нормы — примерно {free.capacity}{' '}
              {pluralize(free.capacity, ['связка', 'связки', 'связок'])} без новых встреч
            </p>
          </>
        ) : lightest ? (
          <>
            <p className={styles.who}>Свободных до нормы нет</p>
            <p className={styles.caption}>
              {`Меньше всего баллов: ${formatPersonShort(lightest.fullName)} — ${points(lightest.load.points)}, уровень «${levelLabel(lightest.load.level)}».`}
            </p>
          </>
        ) : (
          <p className={styles.caption}>Связки пока никто не ведёт.</p>
        )}
        {canAssign && heaviest && heaviest.load.level !== 'NORMAL' && (
          <Button size="sm" variant="secondary" onClick={() => onOpen(heaviest.id)}>
            Передать связку: {formatPersonShort(heaviest.fullName)}
          </Button>
        )}
        <p className={styles.foot}>
          Руководитель и администраторы тоже могут быть ответственными; пока связок у них нет, в расчёт не входят.
          {summary.activeCooperationsOutsideTeam > 0 &&
            ` Ещё ${summary.activeCooperationsOutsideTeam} ${pluralize(summary.activeCooperationsOutsideTeam, ['связку', 'связки', 'связок'])} ведут учётные записи вне команды.`}
        </p>
      </section>
    </Card>
  )
}
