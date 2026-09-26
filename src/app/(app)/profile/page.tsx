'use client'

import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  USER_ROLE_LABELS,
  type CooperationListItemDto,
  type CurrentUserStatsDto,
  type NotificationFeedDto,
} from '@/shared/contracts'
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  MockBadge,
  NO_DATA,
  PageHeader,
  Pie3D,
  Skeleton,
  StageBar,
  Tooltip,
  UiModeSwitch,
  buildQuery,
  cooperationHref,
  firstNameOf,
  formatCount,
  formatDateTime,
  formatNumber,
  formatRelative,
  notificationHref,
  pluralize,
  useCountUp,
  useCurrentUser,
  useResource,
  type IconName,
} from '@/ui'
import { ChangePasswordModal } from './ChangePasswordModal'
import { isSharedDemoAccount } from '@/shared/config/auth.config'
import { Orb } from './Orb'
import { ChannelsBlock } from './ChannelsBlock'
import { ProfileInsights } from './ProfileInsights'
import { ProfilePulse } from './ProfilePulse'
import styles from './profile.module.css'

/**
 * Личный кабинет (решение 96).
 *
 * Было три серые карточки: имя, пять одинаковых плиток и абзац про настройки —
 * «всё чёрное, ничего непонятно». Стало рассказом о человеке и его работе:
 *
 * - шапка — аватар-сфера, вокруг которой по наклонной орбите летают его связки
 *   (красные — где горит), и одна фраза-сводка вместо россыпи чисел;
 * - показатели — плитки с иконками и цветом по смыслу, доля этапов в срок —
 *   объёмным кольцом;
 * - «Мои связки» — сами связки с лентой этапов, а не только их число;
 * - «Последние события» — лента того, что случилось;
 * - настройки — строками, как на странице настроек.
 *
 * Движение (вращение кольца аватара, полёт по орбите, счёт чисел) — только
 * в презентационном режиме; в рабочем всё стоит, структура та же.
 */

const MY_COOPERATIONS_LIMIT = 6

/** Инициалы для аватара: «Кириллов Пётр Андреевич» → «КП». */
function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}

export default function ProfilePage() {
  const user = useCurrentUser()
  const stats = useResource<CurrentUserStatsDto>('/api/me/stats')
  const isRep = user.role === 'UNIVERSITY_REP'
  // Свои связки и лента событий — у сотрудников ИТ-Школы; у представителя вуза свой кабинет.
  const mine = useResource<CooperationListItemDto[]>(
    isRep
      ? null
      : `/api/cooperations${buildQuery({
          responsibleId: user.id,
          status: ['DRAFT', 'ACTIVE', 'PAUSED'],
          sort: '-updatedAt',
          pageSize: 50,
        })}`,
  )
  const feed = useResource<NotificationFeedDto>(isRep ? null : '/api/notifications?limit=6')
  const [isLeaving, setIsLeaving] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  // Временный пароль от администратора (по журналу, GET /api/me): просим сменить.
  // После смены плашка прячется сразу, не дожидаясь перезагрузки страницы.
  const [passwordChanged, setPasswordChanged] = useState(false)
  const showTemporaryNotice = user.passwordTemporary && !passwordChanged

  const data = stats.data
  const cooperations = mine.data ?? []
  const firstName = firstNameOf(user.fullName)

  async function onSignOut() {
    setIsLeaving(true)
    await signOut({ redirectTo: '/login' })
  }

  /** Одна фраза вместо россыпи чисел: сколько связок, где и что горит. */
  const summary = useMemo(() => {
    if (!data) return null
    if (data.activeCooperations === 0) return 'Связок, где вы ответственный, сейчас нет.'
    const parts = [
      `${formatNumber(data.activeCooperations)} ${pluralize(data.activeCooperations, ['связка', 'связки', 'связок'])}`,
      `в ${formatNumber(data.universitiesInWork)} ${pluralize(data.universitiesInWork, ['вузе', 'вузах', 'вузах'])}`,
    ]
    const tail =
      data.overdueStages > 0
        ? `${formatNumber(data.overdueStages)} ${pluralize(data.overdueStages, ['этап просрочен', 'этапа просрочены', 'этапов просрочено'])}`
        : 'просрочек нет'
    return `У вас ${parts.join(' ')} · ${tail}`
  }, [data])

  return (
    <>
      <PageHeader title="Личный кабинет" meta={data?.containsMockData ? <MockBadge /> : undefined} />

      {showTemporaryNotice && (
        <div className={styles.tempPassword} role="status">
          <div className={styles.tempPasswordText}>
            <Icon name="lock" size={18} />
            <p>
              Вы вошли с временным паролем, который выдал администратор. Смените его на свой — временный
              видел не только вы.
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={() => setIsChangingPassword(true)}>
            Сменить пароль
          </Button>
        </div>
      )}

      {/* Шапка: сфера-аватар с орбитой связок и сводка. */}
      <section className={styles.hero} aria-label="Профиль">
        <span className={styles.aurora} aria-hidden />
        <Orb initials={initials(user.fullName)} cooperations={cooperations} />

        <div className={styles.heroText}>
          <span className={styles.kicker}>Здравствуйте, {firstName}</span>
          <h2 className={styles.name}>{user.fullName}</h2>
          <p className={styles.position}>{user.position ?? NO_DATA}</p>
          <div className={styles.chips}>
            <span className={styles.chip}>
              <Icon name="user" size={16} />
              {USER_ROLE_LABELS[user.role]}
            </span>
            <a className={styles.chip} href={`mailto:${user.email}`}>
              <Icon name="mail" size={16} />
              {user.email}
            </a>
            {isRep && (
              <span className={styles.chip}>
                <Icon name="university" size={16} />
                {user.universityName ?? NO_DATA}
              </span>
            )}
          </div>
          {summary && <p className={styles.summary}>{summary}</p>}
        </div>
      </section>

      {/* Показатели: плитки с цветом по смыслу и доля этапов в срок — кольцом. */}
      <section className={styles.block} aria-labelledby="profile-stats">
        <div className={styles.blockHead}>
          <h2 id="profile-stats" className={styles.blockTitle}>
            Ваша работа
          </h2>
          <span className={styles.blockNote}>
            По связкам и этапам, где ответственный — вы
            {data && ` · обновлено ${formatRelative(data.generatedAt)}`}
          </span>
        </div>

        {stats.isLoading ? (
          <div className={styles.statsGrid}>
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className={styles.tile}>
                <Skeleton width="40%" />
                <Skeleton width="60%" height="28px" />
              </div>
            ))}
          </div>
        ) : stats.error ? (
          <ErrorState error={stats.error} onRetry={stats.reload} />
        ) : data ? (
          <div className={styles.statsLayout}>
            <div className={styles.statsGrid}>
              <StatTile
                icon="cooperation"
                tone="violet"
                label="Активные связки"
                value={data.activeCooperations}
                hint="Связки в статусе «Черновик» или «В работе», где вы ответственный."
                order={0}
              />
              <StatTile
                icon="university"
                tone="cyan"
                label="Вузы в работе"
                value={data.universitiesInWork}
                hint="Сколько разных вузов среди ваших связок."
                order={1}
              />
              <StatTile
                icon="program"
                tone="pink"
                label="Программы под управлением"
                value={data.programsManaged}
                hint="Сколько разных образовательных программ среди ваших связок."
                order={2}
              />
              <StatTile
                icon={data.overdueStages > 0 ? 'alert' : 'check'}
                tone={data.overdueStages > 0 ? 'danger' : 'success'}
                label={data.overdueStages > 0 ? 'Просроченные этапы' : 'Просрочек нет'}
                value={data.overdueStages}
                hint="Ваши этапы, у которых срок прошёл, а этап не закрыт."
                order={3}
              />
            </div>

            <figure className={styles.onTime}>
              <Pie3D
                slices={
                  data.stagesOnTimePercent === null
                    ? []
                    : [
                        { key: 'ontime', label: 'В срок', value: Math.round(data.stagesOnTimePercent * 10) / 10, tone: 'success' },
                        {
                          key: 'late',
                          label: 'С опозданием',
                          value: Math.round((100 - data.stagesOnTimePercent) * 10) / 10,
                          tone: 'danger',
                        },
                      ]
                }
                label="Этапы в срок"
                centerLabel="в срок"
                centerValue={
                  data.stagesOnTimePercent === null
                    ? undefined
                    : `${data.stagesOnTimePercent.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`
                }
                valueSuffix="%"
                size={220}
                thickness={0.6}
              />
              <figcaption className={styles.onTimeCaption}>
                <strong>Этапы в срок</strong>
                {data.stagesCompletedWithDeadline > 0
                  ? `По ${formatCount(data.stagesCompletedWithDeadline, [
                      'завершённому этапу со сроком',
                      'завершённым этапам со сроком',
                      'завершённым этапам со сроком',
                    ])}`
                  : 'Завершённых этапов со сроком пока нет'}
              </figcaption>
            </figure>
          </div>
        ) : null}
      </section>

      {/*
        «Система заметила» и «Пульс» (решение 120) — раньше были только
        в сводке Telegram-бота (решение 178, п. 6). Право ANALYTICS —
        представителю вуза они и так закрыты сервером (403), поэтому здесь
        дополнительно скрыты, а не показывают панель с отказом.
      */}
      {user.permissions.canSeeAnalytics && !isRep && (
        <>
          <ProfilePulse />
          <ProfileInsights />
        </>
      )}

      {!isRep && (
        <div className={styles.columns}>
          {/* Мои связки: сами связки с лентой этапов, а не только их число. */}
          <section className={styles.block} aria-labelledby="profile-mine">
            <div className={styles.blockHead}>
              <h2 id="profile-mine" className={styles.blockTitle}>
                Мои связки
              </h2>
              {cooperations.length > MY_COOPERATIONS_LIMIT && (
                <Link className={styles.more} href="/cooperations">
                  Все {formatNumber(cooperations.length)}
                  <Icon name="arrowRight" size={16} />
                </Link>
              )}
            </div>
            {mine.isLoading ? (
              <div className={styles.mineGrid}>
                {Array.from({ length: 2 }, (_, index) => (
                  <div key={index} className={styles.coop}>
                    <Skeleton width="70%" />
                    <Skeleton width="100%" height="6px" />
                  </div>
                ))}
              </div>
            ) : mine.error ? (
              <ErrorState error={mine.error} onRetry={mine.reload} />
            ) : cooperations.length === 0 ? (
              <EmptyState title="Связок нет" description="Вы не назначены ответственным ни в одной связке в работе." />
            ) : (
              <ul className={styles.mineGrid}>
                {cooperations.slice(0, MY_COOPERATIONS_LIMIT).map((item, index) => {
                  const state = item.progress.overdueStages > 0 ? 'overdue' : item.progress.blockedStages > 0 ? 'blocked' : 'ok'
                  return (
                    <li key={item.id} style={{ '--i': index } as CSSProperties} className={styles.coopItem}>
                      <Link className={[styles.coop, styles[state]].join(' ')} href={cooperationHref(item.id)}>
                        <span className={styles.coopUni}>{item.universityShortName ?? item.universityName}</span>
                        <span className={styles.coopProgram}>{item.programName}</span>
                        <span className={styles.coopProduct}>→ {item.productName ?? 'продукт не выбран'}</span>
                        <StageBar
                          done={item.progress.completedStages + item.progress.cancelledStages}
                          current={item.currentStage?.stageNumber ?? null}
                          total={item.progress.totalStages}
                          state={state}
                          delay={index * 90}
                        />
                        <span className={styles.coopFoot}>
                          <span className={styles.coopStage}>
                            {item.currentStage
                              ? `${String(item.currentStage.stageNumber).padStart(2, '0')} / 14 · ${item.currentStage.title}`
                              : 'Все этапы пройдены'}
                          </span>
                          <span className={[styles.coopState, styles[`${state}Text`]].join(' ')}>
                            {state === 'overdue'
                              ? `просрочено: ${item.progress.overdueStages}`
                              : state === 'blocked'
                                ? 'блок'
                                : 'по плану'}
                          </span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* Последние события: что случилось, лентой на линии времени. */}
          <section className={styles.block} aria-labelledby="profile-feed">
            <div className={styles.blockHead}>
              <h2 id="profile-feed" className={styles.blockTitle}>
                Последние события
              </h2>
            </div>
            {feed.isLoading ? (
              <Skeleton width="100%" height="120px" />
            ) : feed.error ? (
              <ErrorState error={feed.error} onRetry={feed.reload} />
            ) : !feed.data || feed.data.items.length === 0 ? (
              <EmptyState title="Событий нет" description="Когда по связкам что-то случится, это появится здесь." />
            ) : (
              <ol className={styles.feed}>
                {feed.data.items.map((item, index) => (
                  <li key={item.id} className={styles.event} style={{ '--i': index } as CSSProperties}>
                    <span className={[styles.eventDot, styles[item.severity]].join(' ')} aria-hidden />
                    <Link className={styles.eventLink} href={notificationHref(item.target)}>
                      <span className={styles.eventTitle}>{item.title}</span>
                      {item.description && <span className={styles.eventText}>{item.description}</span>}
                      <span className={styles.eventTime}>{formatRelative(item.occurredAt)}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}

      {/*
        Настройки — карточкой посередине экрана: строки во всю ширину уводили
        переключатель и «Выйти» к дальнему правому краю, до них было далеко.
      */}
      <section className={[styles.block, styles.settings].join(' ')} aria-labelledby="profile-settings">
        <div className={styles.blockHead}>
          <h2 id="profile-settings" className={styles.blockTitle}>
            Настройки
            <Tooltip text="ФИО, должность, роль и вуз меняет администратор системы в «Настройках», раздел «Пользователи». Почта — адрес для входа, она не меняется. Пароль вы меняете сами — здесь.">
              <span className={styles.hint}>
                <Icon name="info" size={16} />
              </span>
            </Tooltip>
          </h2>
        </div>
        <div className={styles.rows}>
          {/* Режим интерфейса (решение 80) — здесь тоже: на узком экране его нет в шапке. */}
          <Row title="Режим интерфейса" caption="Рабочий — сразу видно, что требует внимания; презентационный — весь визуал для показа.">
            <UiModeSwitch />
          </Row>
          {isSharedDemoAccount(user.email) ? (
            <Row
              title="Пароль"
              caption="Общая демо-учётная запись: под ней входят все проверяющие, поэтому пароль не меняется. Смену пароля можно проверить на своей учётной записи — её заводит администратор."
            >
              {null}
            </Row>
          ) : (
            <Row title="Пароль" caption="Не короче 10 символов, не совпадает с текущим и с адресом почты.">
              <Button variant="secondary" icon="lock" onClick={() => setIsChangingPassword(true)}>
                Сменить пароль
              </Button>
            </Row>
          )}
          {/* Каналы уведомлений (решение 144): Telegram (решение 102), MAX и VK рядом — без
              настроенного бота каждый честно пишет «Не настроено администратором». */}
          <ChannelsBlock />
          <Row title="Выход из системы" caption="Сессия закроется на этом устройстве, вход понадобится заново.">
            <Button variant="danger" icon="logout" onClick={onSignOut} isLoading={isLeaving} disabled={isLeaving}>
              Выйти
            </Button>
          </Row>
        </div>
      </section>

      {data && <p className={styles.generated}>Показатели посчитаны: {formatDateTime(data.generatedAt)}</p>}

      {isChangingPassword && (
        <ChangePasswordModal onClose={() => setIsChangingPassword(false)} onChanged={() => setPasswordChanged(true)} />
      )}
    </>
  )
}

function StatTile({
  icon,
  tone,
  label,
  value,
  hint,
  order,
}: {
  icon: IconName
  tone: 'violet' | 'cyan' | 'pink' | 'danger' | 'success'
  label: string
  value: number | null
  hint: string
  order: number
}) {
  const counted = useCountUp(value, 900)
  return (
    <div className={[styles.tile, styles[tone]].join(' ')} style={{ '--i': order } as CSSProperties} title={hint}>
      <span className={styles.tileIcon}>
        <Icon name={icon} size={18} />
      </span>
      <span className={styles.tileValue}>{counted === null ? 'Нет данных' : formatNumber(Math.round(counted))}</span>
      <span className={styles.tileLabel}>{label}</span>
    </div>
  )
}

function Row({ title, caption, children }: { title: string; caption: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowTitle}>{title}</span>
        <span className={styles.rowCaption}>{caption}</span>
      </div>
      <div className={styles.rowSide}>{children}</div>
    </div>
  )
}
