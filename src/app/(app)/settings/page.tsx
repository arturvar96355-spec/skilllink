'use client'

import { useState, type ReactNode } from 'react'
import {
  CONFIDENCE_LABELS,
  DATA_SOURCE_TYPE_LABELS,
  type DataSourceDto,
  type IntegrationsStatusDto,
  type MarketDataSyncResultDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  PageHeader,
  Skeleton,
  Tooltip,
  UiModeSwitch,
  apiPost,
  buildQuery,
  formatDateTime,
  formatNumber,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
  useUiMode,
} from '@/ui'
import styles from './settings.module.css'

/**
 * Настройки системы — плотным списком «параметр — значение — изменить»,
 * по разделам, как настройки в инструментах разработчика (ТЗ визуалу, п. 3).
 *
 * Карточки с поясняющими абзацами заменены строками: пояснение раздела — за
 * значком (i) у заголовка, три значка интеграции — одним статусом, у источника
 * на виду три поля, остальное — по «Подробнее» (ТЗ фронту, задачи 6–9).
 * Ни одно сведение со страницы не убрано — только спрятано до запроса.
 *
 * Разделы, закрытые для роли, не рисуются вхолостую (раздел 32 шаблона страниц):
 * источники и интеграции требуют права на аналитику, без него — объяснение.
 */

/** Сколько источников показывать: их единицы, страницы здесь были бы лишними. */
const SOURCES_QUERY = buildQuery({ pageSize: 50 })

/**
 * Источник рыночных данных — словами, а не ключом настройки (`mock`, `csv`…):
 * ключ нужен администратору в .env, а на экране он ничего не говорит.
 * Неизвестный ключ показывается как есть — новый источник не пропадёт.
 */
const PROVIDER_LABELS: Record<string, string> = {
  mock: 'демонстрационный набор',
  csv: 'файл CSV',
  'external-api': 'внешний API',
  'future-rtk': 'источник РТК',
}

type Integration = IntegrationsStatusDto['integrations'][number]

/**
 * Три признака интеграции — одним статусом (ТЗ фронту, задача 7).
 * Приоритет: выключена > не настроена > подключена. У выключенной настройка
 * и демо-признак не показываются — они ничего не значат, пока она не работает.
 * TODO: PM DECISION — формулировки статусов согласовать с Артуром до вливания.
 */
function integrationStatus(item: Integration): { label: string; tone: 'neutral' | 'warning' | 'success' } {
  if (!item.enabled) return { label: 'Выключена', tone: 'neutral' }
  if (!item.configured) return { label: 'Требует настройки', tone: 'warning' }
  return { label: item.isMock ? 'Подключена (демо)' : 'Подключена', tone: 'success' }
}

/** Раздел списка: заголовок, пояснение за (i), действие справа, строки. */
function Group({
  title,
  hint,
  action,
  id,
  children,
}: {
  title: string
  hint?: string
  action?: ReactNode
  id?: string
  children: ReactNode
}) {
  return (
    <section className={styles.group} id={id}>
      <div className={styles.groupHead}>
        <h2 className={styles.groupTitle}>
          {title}
          {hint && (
            <Tooltip text={hint}>
              <span className={styles.hint}>
                <Icon name="info" size={16} />
              </span>
            </Tooltip>
          )}
        </h2>
        {action}
      </div>
      <div className={styles.rows}>{children}</div>
    </section>
  )
}

/** Строка «параметр — значение — изменить». */
function Row({ label, hint, value, control }: { label: ReactNode; hint?: string; value?: ReactNode; control?: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>
        {label}
        {hint && (
          <Tooltip text={hint}>
            <span className={styles.hint}>
              <Icon name="info" size={16} />
            </span>
          </Tooltip>
        )}
      </span>
      <span className={styles.value}>{value}</span>
      {control && <span className={styles.control}>{control}</span>}
    </div>
  )
}

/**
 * Источник: на виду название, тип и последняя загрузка; надёжность, число
 * показателей, описание и адрес — по «Подробнее» (ТЗ фронту, задача 8).
 */
function SourceRow({ source }: { source: DataSourceDto }) {
  const [isOpen, setIsOpen] = useState(false)
  const detailsId = `source-${source.id}`
  return (
    <div className={styles.source}>
      <div className={styles.row}>
        <span className={styles.label}>
          {source.name}
          {source.isMock && <Badge tone="mock">демо</Badge>}
        </span>
        <span className={styles.value}>
          {DATA_SOURCE_TYPE_LABELS[source.type]} · загружено {formatDateTime(source.updatedAt)}
        </span>
        <span className={styles.control}>
          <button
            type="button"
            className={styles.disclosure}
            aria-expanded={isOpen}
            aria-controls={detailsId}
            onClick={() => setIsOpen((open) => !open)}
          >
            Подробнее
            <Icon name="chevronDown" size={16} className={styles.chevron} />
          </button>
        </span>
      </div>
      {isOpen && (
        <dl className={styles.details} id={detailsId}>
          <div>
            <dt>Надёжность</dt>
            <dd>{CONFIDENCE_LABELS[source.reliability]}</dd>
          </div>
          <div>
            <dt>Показателей</dt>
            <dd className={styles.number}>{formatNumber(source.demandRecords)}</dd>
          </div>
          {source.collectionDate && (
            <div>
              <dt>Данные собраны</dt>
              <dd>{formatDateTime(source.collectionDate)}</dd>
            </div>
          )}
          {source.description && (
            <div>
              <dt>Описание</dt>
              <dd>{source.description}</dd>
            </div>
          )}
          {source.url && (
            <div>
              <dt>Адрес</dt>
              <dd className={styles.url}>{source.url}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}

/** Строки-заглушки на время загрузки: высота списка не прыгает. */
function RowsSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.row}>
          <Skeleton width="40%" />
          <Skeleton width="60%" />
        </div>
      ))}
    </>
  )
}

function Locked({ what }: { what: string }) {
  return (
    <div className={styles.locked}>
      <EmptyState icon="lock" title="Раздел недоступен" description={`${what} видны ролям с доступом к аналитике. У вашей роли его нет.`} />
    </div>
  )
}

export default function SettingsPage() {
  const user = useCurrentUser()
  const toast = useToast()
  const { isWork } = useUiMode()

  const canSeeSources = user.permissions.canSeeAnalytics
  // Синхронизация — право записи (контракт, POST /api/data-sources/sync). Кнопка
  // показывалась только администратору, и менеджеру страница писала «запускает
  // администратор», хотя сервер его запрос принимал.
  const canSync = user.permissions.canWrite

  const sources = useResource<DataSourceDto[]>(canSeeSources ? `/api/data-sources${SOURCES_QUERY}` : null)
  const integrations = useResource<IntegrationsStatusDto>(canSeeSources ? '/api/integrations/status' : null)

  const sync = useMutation(async () => {
    const result = await apiPost<MarketDataSyncResultDto>('/api/data-sources/sync')
    return result.data
  })

  async function onSync() {
    const result = await sync.run(undefined)
    if (!result.ok) {
      // Текст отказа приходит с сервера на русском и объясняет причину — своим не подменяем.
      toast.error(result.error.message)
      return
    }

    const { provider, imported, updated, unknownSkills } = result.data
    const unknown =
      unknownSkills.length > 0
        ? ` Навыков не найдено в справочнике: ${unknownSkills.length} (${unknownSkills.join(', ')}). Они пропущены.`
        : ''
    toast.success(`Источник «${provider}»: создано ${imported}, обновлено ${updated}.${unknown}`)
    sources.reload()
  }

  const syncControl = canSync ? (
    <Button icon="refresh" onClick={onSync} isLoading={sync.isPending} variant="secondary" size="sm">
      Синхронизировать
    </Button>
  ) : (
    <span className={styles.muted}>Запускает сотрудник с правом записи</span>
  )

  return (
    <>
      <PageHeader title="Настройки" />

      <div className={styles.list}>
        {/* Режим интерфейса (решение 80): выбор каждого человека, хранится в его браузере. */}
        <Group title="Интерфейс">
          <Row
            label="Режим"
            hint="Рабочий — для ежедневной работы: реестры списком и сразу видно, что требует внимания. Презентационный — весь визуал для показа. Выбор запоминается в этом браузере."
            value={isWork ? 'для ежедневной работы' : 'весь визуал для показа'}
            control={<UiModeSwitch />}
          />
        </Group>

        <Group
          title="Рыночные данные"
          hint="Записи об источниках создаются при загрузке рыночных данных. Какие источники включены, задаётся переменными окружения на сервере."
        >
          {!canSeeSources ? (
            <Locked what="Источники данных" />
          ) : integrations.isLoading ? (
            <RowsSkeleton count={2} />
          ) : integrations.error ? (
            <ErrorState error={integrations.error} onRetry={integrations.reload} />
          ) : integrations.data ? (
            <>
              <Row
                label="Активный источник"
                value={PROVIDER_LABELS[integrations.data.marketDataProvider] ?? integrations.data.marketDataProvider}
                control={syncControl}
              />
              <Row label="Состояние проверено" value={formatDateTime(integrations.data.checkedAt)} />
            </>
          ) : null}
        </Group>

        <Group title="Источники данных">
          {!canSeeSources ? (
            <Locked what="Источники данных" />
          ) : sources.isLoading ? (
            <RowsSkeleton count={3} />
          ) : sources.error ? (
            <ErrorState error={sources.error} onRetry={sources.reload} />
          ) : sources.data && sources.data.length > 0 ? (
            <div className={sources.isRefreshing ? styles.refreshing : undefined}>
              {sources.data.map((source) => (
                <SourceRow key={source.id} source={source} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon="analytics"
              title="Источников нет"
              description="Рыночные данные ещё ни разу не загружались, поэтому записи об источнике не появилось."
              action={
                canSync ? (
                  <Button icon="refresh" onClick={onSync} isLoading={sync.isPending}>
                    Загрузить сейчас
                  </Button>
                ) : undefined
              }
            />
          )}
        </Group>

        {/* Якорь: на него ведёт ссылка из подвала. */}
        <Group
          id="integrations"
          title="Интеграции"
          hint="Состояние как есть: выключенная интеграция так и называется выключенной. Включение задаётся переменными окружения."
        >
          {!canSeeSources ? (
            <Locked what="Интеграции" />
          ) : integrations.isLoading ? (
            <RowsSkeleton count={3} />
          ) : integrations.error ? (
            <ErrorState error={integrations.error} onRetry={integrations.reload} />
          ) : integrations.data ? (
            integrations.data.integrations.map((item) => {
              const status = integrationStatus(item)
              return (
                <Row
                  key={item.key}
                  label={item.name}
                  hint={item.reason ?? undefined}
                  value={
                    <Badge tone={status.tone} withDot>
                      {status.label}
                    </Badge>
                  }
                />
              )
            })
          ) : null}
        </Group>

        <Group title="О системе">
          <Row
            label="Версия"
            hint="Номер версии и сборки система не публикует — придумывать значение мы не стали."
            value={<span className={styles.muted}>не публикуется</span>}
          />
          <Row
            label="Демонстрационные данные"
            value="помечены значком и за статистику не выдаются"
          />
          {/* Обычные ссылки, а не переходы внутри приложения: это ответы API. */}
          <Row
            label="Состояние системы"
            value={<span className={styles.code}>/api/health</span>}
            control={
              <a className={styles.link} href="/api/health" target="_blank" rel="noreferrer">
                Открыть
                <Icon name="external" size={16} />
              </a>
            }
          />
          <Row
            label="Спецификация OpenAPI"
            value={<span className={styles.code}>/api/openapi.json</span>}
            control={
              <a className={styles.link} href="/api/openapi.json" target="_blank" rel="noreferrer">
                Открыть
                <Icon name="external" size={16} />
              </a>
            }
          />
        </Group>
      </div>
    </>
  )
}
