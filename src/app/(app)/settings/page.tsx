'use client'

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
  Card,
  CardsSkeleton,
  EmptyState,
  ErrorState,
  Icon,
  MockBadge,
  PageHeader,
  Section,
  TableSkeleton,
  DataTable,
  apiPost,
  buildQuery,
  formatDateTime,
  formatNumber,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
  type Column,
} from '@/ui'
import styles from './settings.module.css'

/**
 * Настройки системы: источники данных, интеграции и сведения о самой системе.
 *
 * Разделы, закрытые для роли, не рисуются вхолостую (раздел 32 шаблона страниц):
 * и список источников, и состояние интеграций требуют права на аналитику,
 * поэтому без него вместо таблиц показывается объяснение, а не пустой экран.
 */

/** Сколько источников показывать: их единицы, страницы здесь были бы лишними. */
const SOURCES_QUERY = buildQuery({ pageSize: 50 })

export default function SettingsPage() {
  const user = useCurrentUser()
  const toast = useToast()

  const canSeeSources = user.permissions.canSeeAnalytics
  // Синхронизация — право записи (контракт, POST /api/data-sources/sync). Кнопка
  // показывалась только администратору, и менеджеру страница писала «запускает
  // администратор», хотя сервер его запрос принимал.
  const canSync = user.permissions.canWrite

  const sources = useResource<DataSourceDto[]>(canSeeSources ? `/api/data-sources${SOURCES_QUERY}` : null)
  const integrations = useResource<IntegrationsStatusDto>(
    canSeeSources ? '/api/integrations/status' : null,
  )

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

  const sourceColumns: Column<DataSourceDto>[] = [
    {
      key: 'name',
      title: 'Источник',
      render: (row) => (
        <span className={styles.cell}>
          <span className={styles.cellTitle}>
            {row.name}
            {row.isMock && <Badge tone="mock">демо</Badge>}
          </span>
          {row.description && <span className={styles.cellMeta}>{row.description}</span>}
          {row.url && <span className={styles.cellMeta}>{row.url}</span>}
        </span>
      ),
    },
    {
      key: 'type',
      title: 'Тип',
      width: '180px',
      render: (row) => <span className={styles.cellMeta}>{DATA_SOURCE_TYPE_LABELS[row.type]}</span>,
    },
    {
      key: 'reliability',
      title: 'Надёжность',
      width: '130px',
      render: (row) => <span className={styles.cellMeta}>{CONFIDENCE_LABELS[row.reliability]}</span>,
    },
    {
      key: 'records',
      title: 'Показателей',
      align: 'right',
      width: '120px',
      render: (row) => <span className={styles.number}>{formatNumber(row.demandRecords)}</span>,
    },
    {
      key: 'updatedAt',
      title: 'Последняя загрузка',
      width: '180px',
      render: (row) => (
        <span className={styles.cell}>
          <span className={styles.cellMeta}>{formatDateTime(row.updatedAt)}</span>
          {row.collectionDate && (
            <span className={styles.cellMeta}>Данные собраны: {formatDateTime(row.collectionDate)}</span>
          )}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Настройки"
        description="Откуда система берёт данные, что из этого подключено и где посмотреть её состояние."
      />

      <Section
        title="Источники данных"
        description="Записи создаются при загрузке рыночных данных. Включение самих источников задаётся переменными окружения — их состояние показано ниже, в разделе «Интеграции»."
        action={
          !canSeeSources ? undefined : canSync ? (
            <Button icon="refresh" onClick={onSync} isLoading={sync.isPending} variant="secondary">
              Синхронизировать
            </Button>
          ) : (
            <span className={styles.permissionNote}>Синхронизацию запускает сотрудник с правом записи</span>
          )
        }
      >
        {!canSeeSources ? (
          <Card muted>
            <EmptyState
              icon="lock"
              title="Раздел недоступен"
              description="Источники данных видны ролям с доступом к аналитике. У вашей роли его нет."
            />
          </Card>
        ) : sources.isLoading ? (
          <Card padding="none">
            <TableSkeleton rows={3} columns={5} />
          </Card>
        ) : sources.error ? (
          <ErrorState error={sources.error} onRetry={sources.reload} />
        ) : (
          <Card padding="none">
            {sources.data && sources.data.length > 0 ? (
              <DataTable
                rows={sources.data}
                columns={sourceColumns}
                getRowKey={(row) => row.id}
                isRefreshing={sources.isRefreshing}
                caption="Источники данных системы"
              />
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
          </Card>
        )}
      </Section>

      {/* Якорь: на него ведёт ссылка из подвала. */}
      <div id="integrations" className={styles.anchor}>
        <Section
          title="Интеграции"
          description="Состояние как есть: выключенная интеграция так и называется выключенной."
        >
          {!canSeeSources ? (
            <Card muted>
              <EmptyState
                icon="lock"
                title="Раздел недоступен"
                description="Состояние интеграций видно ролям с доступом к аналитике. У вашей роли его нет."
              />
            </Card>
          ) : integrations.isLoading ? (
            <CardsSkeleton count={3} />
          ) : integrations.error ? (
            <ErrorState error={integrations.error} onRetry={integrations.reload} />
          ) : integrations.data ? (
            <>
              <div className={styles.integrations}>
                {integrations.data.integrations.map((item) => (
                  <Card key={item.key}>
                    <div className={styles.integrationHead}>
                      <span className={styles.cellTitle}>{item.name}</span>
                      <Badge tone={item.enabled ? 'success' : 'neutral'} withDot>
                        {item.enabled ? 'Включена' : 'Выключена'}
                      </Badge>
                    </div>
                    <div className={styles.badges}>
                      <Badge tone={item.configured ? 'info' : 'warning'}>
                        {item.configured ? 'Настроена' : 'Не настроена'}
                      </Badge>
                      {item.isMock && <MockBadge />}
                    </div>
                    <p className={styles.cellMeta}>
                      {item.reason ?? 'Дополнительных пояснений источник не передал.'}
                    </p>
                    <p className={styles.key}>{item.key}</p>
                  </Card>
                ))}
              </div>
              <p className={styles.generated}>
                Активный поставщик рыночных данных: {integrations.data.marketDataProvider}. Проверено:{' '}
                {formatDateTime(integrations.data.checkedAt)}.
              </p>
            </>
          ) : null}
        </Section>
      </div>

      <Section title="О системе">
        <Card>
          <p className={styles.note}>
            Номер версии и сборки система не публикует — здесь его нет намеренно, придумывать
            значение мы не стали.
          </p>
          <p className={styles.note}>
            Часть данных демонстрационная. Такие записи помечены значком «Демонстрационные
            данные» и за подтверждённую статистику не выдаются.
          </p>
          <div className={styles.links}>
            {/* Обычные ссылки, а не переходы внутри приложения: это ответы API. */}
            <a className={styles.apiLink} href="/api/health" target="_blank" rel="noreferrer">
              <Icon name="external" size={16} />
              Состояние системы — /api/health
            </a>
            <a className={styles.apiLink} href="/api/openapi.json" target="_blank" rel="noreferrer">
              <Icon name="external" size={16} />
              Спецификация OpenAPI — /api/openapi.json
            </a>
          </div>
        </Card>
      </Section>
    </>
  )
}
