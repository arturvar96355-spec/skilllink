import Link from 'next/link'
import type { CSSProperties } from 'react'
import type { CurrentUserDto, PortalOverviewDto } from '@/shared/contracts'
import {
  EmptyState,
  ErrorState,
  Icon,
  Progress,
  ROUTES,
  Skeleton,
  StageStatusBadge,
  formatRelative,
  type Resource,
} from '@/ui'
import { RoleGuide } from './RoleGuide'
import { StatTile } from './StatTile'
import { roleGuide } from './profile-role'
import styles from './profile.module.css'

/**
 * «Ваш вуз» — личный кабинет представителя вуза (решение 236).
 *
 * Раньше у представителя стояли плитки сотрудника ИТ-Школы «Активные связки: 0»,
 * «Вузы в работе: 0» и «Нет данных» в кольце — про чужую работу. Теперь — его вуз
 * по той же сводке, что и в разделе «Мой вуз» (`GET /api/portal/overview`, одна база
 * подсчёта): программы, связки с ИТ-Школой, материалы к подтверждению, документы;
 * ниже — связки с текущим этапом и что представитель делает в системе.
 */
export function UniversityBlock({ user, overview }: { user: CurrentUserDto; overview: Resource<PortalOverviewDto> }) {
  const data = overview.data
  const pending = data?.pendingMaterials ?? 0

  return (
    <>
      <section className={styles.block} aria-labelledby="profile-university">
        <div className={styles.blockHead}>
          <h2 id="profile-university" className={styles.blockTitle}>
            Ваш вуз
          </h2>
          <Link className={styles.more} href={ROUTES.portal}>
            Открыть «Мой вуз»
            <Icon name="arrowRight" size={16} />
          </Link>
        </div>

        {overview.isLoading && !data ? (
          <div className={[styles.statsGrid, styles.statsGridWide].join(' ')}>
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className={styles.tile}>
                <Skeleton width="40%" />
                <Skeleton width="60%" height="28px" />
              </div>
            ))}
          </div>
        ) : overview.error ? (
          <ErrorState error={overview.error} onRetry={overview.reload} />
        ) : data ? (
          <>
            <div className={[styles.statsGrid, styles.statsGridWide].join(' ')}>
              <StatTile
                icon="program"
                tone="cyan"
                label="Программы вуза"
                value={data.programs.length}
                hint="Образовательные программы вашего вуза в SkillLink."
                order={0}
              />
              <StatTile
                icon="cooperation"
                tone="violet"
                label="Связки с ИТ-Школой"
                value={data.cooperations.length}
                hint="Программы, по которым ИТ-Школа ведёт с вузом совместную работу."
                order={1}
              />
              <StatTile
                icon={pending > 0 ? 'alert' : 'check'}
                tone={pending > 0 ? 'danger' : 'success'}
                label={pending > 0 ? 'Материалы ждут подтверждения' : 'Подтверждать сейчас нечего'}
                value={pending}
                hint="Материалы, которые ИТ-Школа передала и которые вуз ещё не подтвердил."
                order={2}
              />
              <StatTile
                icon="document"
                tone="pink"
                label="Документы по связкам"
                value={data.documentsCount}
                hint="Договоры, акты и материалы по связкам вашего вуза."
                order={3}
              />
            </div>
            <p className={styles.blockFoot}>
              По данным раздела «Мой вуз» · обновлено {formatRelative(data.generatedAt)}
            </p>
          </>
        ) : null}
      </section>

      <div className={styles.columns}>
        <section className={styles.block} aria-labelledby="profile-university-coops">
          <div className={styles.blockHead}>
            <h2 id="profile-university-coops" className={styles.blockTitle}>
              Связки вуза
            </h2>
          </div>
          {overview.isLoading && !data ? (
            <div className={styles.mineGrid}>
              {Array.from({ length: 2 }, (_, index) => (
                <div key={index} className={styles.coop}>
                  <Skeleton width="70%" />
                  <Skeleton width="100%" height="6px" />
                </div>
              ))}
            </div>
          ) : overview.error || !data ? null : data.cooperations.length === 0 ? (
            <EmptyState
              title="Связок пока нет"
              description="Когда ИТ-Школа начнёт работу с программой вашего вуза, связка появится здесь и в разделе «Мой вуз»."
            />
          ) : (
            <ul className={[styles.mineGrid, styles.mineList].join(' ')}>
              {data.cooperations.map((item, index) => (
                <li key={item.id} style={{ '--i': index } as CSSProperties} className={styles.coopItem}>
                  <Link className={styles.coop} href={ROUTES.portal}>
                    <span className={styles.coopProgram}>{item.programName}</span>
                    <span className={styles.coopProduct}>→ {item.productName ?? 'продукт не выбран'}</span>
                    <Progress value={item.progressPercent} withValue label="Готовность связки" />
                    <span className={styles.coopFoot}>
                      <span className={styles.coopStage}>
                        {item.currentStageNumber === null
                          ? 'Все этапы пройдены'
                          : `${String(item.currentStageNumber).padStart(2, '0')} / 14 · ${item.currentStageTitle}`}
                      </span>
                      {item.currentStageStatus && <StageStatusBadge status={item.currentStageStatus} />}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <RoleGuide guide={roleGuide(user)} id="profile-role" />
      </div>
    </>
  )
}
