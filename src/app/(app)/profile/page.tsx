'use client'

import { signOut } from 'next-auth/react'
import { useState } from 'react'
import { USER_ROLE_LABELS, type CurrentUserStatsDto } from '@/shared/contracts'
import {
  Avatar,
  Button,
  Card,
  CardsSkeleton,
  ErrorState,
  KpiCard,
  KpiRow,
  MockBadge,
  NO_DATA,
  PageHeader,
  Section,
  formatCount,
  formatDateTime,
  useCurrentUser,
  useResource,
} from '@/ui'
import styles from './profile.module.css'

/**
 * Личный кабинет.
 *
 * Раздел 12 шаблона страниц: кабинет проще остальных экранов и состоит ровно
 * из трёх областей — личные данные, статистика, настройки. Рабочих вкладок
 * здесь нет намеренно: за ними не стоит данных, а вкладку без содержимого
 * дизайн-система прямо запрещает.
 */

interface ProfileField {
  label: string
  value: string
  /** Почта должна открываться в почтовом клиенте, а не просто лежать текстом. */
  href?: string
}

export default function ProfilePage() {
  const user = useCurrentUser()
  const stats = useResource<CurrentUserStatsDto>('/api/me/stats')
  const [isLeaving, setIsLeaving] = useState(false)

  const data = stats.data

  const fields: ProfileField[] = [
    { label: 'Роль в системе', value: USER_ROLE_LABELS[user.role] },
    { label: 'Рабочая почта', value: user.email, href: `mailto:${user.email}` },
  ]
  // Вуз заполнен только у представителя вуза: у сотрудников ИТ-Школы это поле пустое всегда,
  // и показывать вечное «Нет данных» смысла нет.
  if (user.role === 'UNIVERSITY_REP') {
    fields.push({ label: 'Вуз', value: user.universityName ?? NO_DATA })
  }

  async function onSignOut() {
    setIsLeaving(true)
    await signOut({ redirectTo: '/login' })
  }

  return (
    <>
      <PageHeader
        title="Личный кабинет"
        description="Ваши данные, ваша работа и выход из системы."
        meta={data?.containsMockData ? <MockBadge /> : undefined}
      />

      <Section title="Личные данные">
        <Card>
          <div className={styles.identity}>
            <Avatar name={user.fullName} size="xl" />
            <div className={styles.identityText}>
              <p className={styles.name}>{user.fullName}</p>
              <p className={styles.position}>{user.position ?? NO_DATA}</p>
            </div>
          </div>

          <dl className={styles.fields}>
            {fields.map((field) => (
              <div key={field.label} className={styles.field}>
                <dt className={styles.fieldLabel}>{field.label}</dt>
                <dd className={styles.fieldValue}>
                  {field.href ? (
                    <a className={styles.link} href={field.href}>
                      {field.value}
                    </a>
                  ) : (
                    field.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </Section>

      <Section
        title="Статистика"
        description="Считается по связкам и этапам, где ответственный — вы."
      >
        {stats.isLoading ? (
          <CardsSkeleton count={3} />
        ) : stats.error ? (
          <ErrorState error={stats.error} onRetry={stats.reload} />
        ) : data ? (
          <>
            <KpiRow>
              <KpiCard
                label="Активные связки"
                value={data.activeCooperations}
                explanation="Связки в статусе «Черновик» или «В работе», где вы ответственный."
              />
              <KpiCard
                label="Вузы в работе"
                value={data.universitiesInWork}
                explanation="Сколько разных вузов среди ваших связок."
              />
              <KpiCard
                label="Программы под управлением"
                value={data.programsManaged}
                explanation="Сколько разных образовательных программ среди ваших связок."
              />
              <KpiCard
                label="Этапы в срок"
                value={data.stagesOnTimePercent}
                unit="%"
                fractionDigits={1}
                explanation="Доля ваших завершённых этапов, закрытых не позже срока."
                note={
                  data.stagesCompletedWithDeadline > 0
                    ? `По ${formatCount(data.stagesCompletedWithDeadline, [
                        'завершённому этапу со сроком',
                        'завершённым этапам со сроком',
                        'завершённым этапам со сроком',
                      ])}`
                    : 'Завершённых этапов со сроком пока нет'
                }
              />
              <KpiCard
                label="Просроченные этапы"
                value={data.overdueStages}
                explanation="Ваши этапы, у которых срок прошёл, а этап не закрыт."
              />
            </KpiRow>
            <p className={styles.generated}>Обновлено: {formatDateTime(data.generatedAt)}</p>
          </>
        ) : null}
      </Section>

      <Section title="Настройки">
        <Card>
          <p className={styles.note}>
            Настройки профиля меняет администратор системы: ФИО, должность, роль, почту и
            привязку к вузу заводит он, изменить их из интерфейса нельзя — такого действия в
            API нет. Показывать переключатели, за которыми ничего не происходит, мы не стали.
          </p>
          <div className={styles.exit}>
            <div className={styles.exitText}>
              <p className={styles.exitTitle}>Выход из системы</p>
              <p className={styles.note}>
                Сессия закроется на этом устройстве, вход понадобится заново.
              </p>
            </div>
            <Button
              variant="danger"
              icon="logout"
              onClick={onSignOut}
              isLoading={isLeaving}
              disabled={isLeaving}
            >
              Выйти
            </Button>
          </div>
        </Card>
      </Section>
    </>
  )
}
