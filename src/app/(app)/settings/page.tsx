'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import {
  CONFIDENCE_LABELS,
  DATA_SOURCE_TYPE_LABELS,
  type DataSourceDto,
  type IntegrationsStatusDto,
  type MarketDataSyncResultDto,
} from '@/shared/contracts'
import {
  ROUTES,
  API_CONTRACT_URL,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  PageHeader,
  UiModeSwitch,
  apiPost,
  buildQuery,
  formatDateTime,
  formatNumber,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
} from '@/ui'
import { AdminChannelsSection } from './AdminChannelsSection'
import { AuditSection } from './AuditSection'
import { Hint, Row, RowsSkeleton } from './SettingsRow'
import { TelegramBotAdminSection } from './TelegramBotAdminSection'
import { UsersSection } from './UsersSection'
import styles from './settings.module.css'

/**
 * Настройки системы — как настройки Claude: слева колонка разделов, справа один
 * раздел — заголовок и строки «название с короткой подписью — значение или
 * действие» через тонкую линию (ТЗ визуалу, п. 3).
 *
 * Длинные пояснения разделов — за значком (i) у заголовка; у интеграции один
 * статус вместо трёх значков; у источника на виду три поля, остальное — по
 * «Подробнее» (ТЗ фронту, задачи 6–9). Ни одно сведение не убрано.
 *
 * Раздел хранится в адресе (`#integrations`): ссылка из подвала открывает его,
 * «Назад» в браузере возвращает к предыдущему.
 *
 * Разделы, закрытые для роли, не рисуются вхолостую (раздел 32 шаблона страниц):
 * источники и интеграции требуют права на аналитику, без него — объяснение.
 *
 * «Пользователи» и «Журнал действий» (ТЗ, п. 5) — только администратору: другим
 * ролям этих пунктов в колонке нет вовсе, а адрес `#users` открывает «Интерфейс».
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

const SECTIONS = [
  { key: 'interface', label: 'Интерфейс', icon: 'settings', adminOnly: false },
  { key: 'market', label: 'Рыночные данные', icon: 'analytics', adminOnly: false },
  { key: 'sources', label: 'Источники данных', icon: 'document', adminOnly: false },
  { key: 'integrations', label: 'Интеграции', icon: 'cooperation', adminOnly: false },
  { key: 'users', label: 'Пользователи', icon: 'user', adminOnly: true },
  { key: 'audit', label: 'Журнал действий', icon: 'clock', adminOnly: true },
  { key: 'about', label: 'О системе', icon: 'info', adminOnly: false },
] as const

type SectionKey = (typeof SECTIONS)[number]['key']
type Section = (typeof SECTIONS)[number]

/** Разделы с таблицами — шире остальных: строке пользователя и записи журнала тесно в 720 px. */
const WIDE_SECTIONS: readonly SectionKey[] = ['users', 'audit']

function sectionFromHash(available: readonly Section[]): SectionKey {
  const hash = typeof window === 'undefined' ? '' : window.location.hash.slice(1)
  return available.find((section) => section.key === hash)?.key ?? 'interface'
}

type Integration = IntegrationsStatusDto['integrations'][number]

/**
 * ИИ-помощник одной строкой (решение 90): кто пишет черновики — модель или шаблон.
 * Ключей в ответе API нет — только провайдер, модель и чего не хватает.
 */
function aiAssistRow(ai: IntegrationsStatusDto['aiAssist']): {
  caption: string
  label: string
  tone: 'neutral' | 'warning' | 'success'
} {
  if (ai.provider === 'off') {
    return { caption: 'Выключен — ответы пишет шаблон', label: 'Выключен', tone: 'neutral' }
  }
  const name = ai.model ? `${ai.name} (${ai.model})` : ai.name
  if (!ai.ready) {
    return {
      caption: `${name} — не настроен, ответы пишет шаблон${ai.reason ? `. ${ai.reason}` : ''}`,
      label: 'Требует настройки',
      tone: 'warning',
    }
  }
  return { caption: `${name} — подключён`, label: 'Подключён', tone: 'success' }
}

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

/**
 * Источник: на виду название, тип и последняя загрузка; надёжность, число
 * показателей, описание и адрес — по «Подробнее» (ТЗ фронту, задача 8).
 */
function SourceRow({ source }: { source: DataSourceDto }) {
  const [isOpen, setIsOpen] = useState(false)
  const detailsId = `source-${source.id}`
  return (
    <div className={styles.source}>
      <Row
        title={
          <>
            {source.name}
            {source.isMock && <Badge tone="mock">демо</Badge>}
          </>
        }
        caption={`${DATA_SOURCE_TYPE_LABELS[source.type]} · загружено ${formatDateTime(source.updatedAt)}`}
      >
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
      </Row>
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
              <dd className={styles.muted}>{source.url}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}

function Locked({ what }: { what: string }) {
  return (
    <EmptyState
      icon="lock"
      title="Раздел недоступен"
      description={`${what} видны ролям с доступом к аналитике. У вашей роли его нет.`}
    />
  )
}

export default function SettingsPage() {
  const user = useCurrentUser()
  const toast = useToast()
  const [active, setActive] = useState<SectionKey>('interface')
  const isAdmin = user.permissions.isAdmin
  const sections = SECTIONS.filter((section) => !section.adminOnly || isAdmin)

  // Раздел из адреса — после монтирования: на сервере адреса с # нет.
  useEffect(() => {
    const available = SECTIONS.filter((section) => !section.adminOnly || isAdmin)
    const sync = () => setActive(sectionFromHash(available))
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [isAdmin])

  // На телефоне разделы — полосой с прокруткой: выбранный должен быть виден.
  useEffect(() => {
    document
      .querySelector(`.${styles.nav} [aria-current='page']`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  function choose(key: SectionKey) {
    setActive(key)
    // Не прыгаем к якорю: раздел и так открыт сверху.
    window.history.pushState(null, '', `#${key}`)
  }

  const canSeeSources = user.permissions.canSeeAnalytics
  // Синхронизация — работа с аналитикой (POST /api/data-sources/sync, решение 98):
  // администратор, менеджер и аналитик. Кнопка у тех, чей запрос сервер примет.
  const canSync = user.permissions.canWorkAnalytics

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

  const current = sections.find((section) => section.key === active) ?? sections[0]!

  const hints: Partial<Record<SectionKey, string>> = {
    market:
      'Записи об источниках создаются при загрузке рыночных данных. Какие источники включены, задаётся переменными окружения на сервере.',
    integrations:
      'Состояние как есть: выключенная интеграция так и называется выключенной. Включение задаётся переменными окружения.',
    users:
      'Сотрудники ИТ-Школы и представители вузов. Пароль нового пользователя система придумывает сама и показывает один раз; блокировка действует сразу, в том числе на открытые сессии.',
    audit:
      'Кто и что делал в системе. Пароли и персональные данные в журнал не пишутся — только служебные поля действия.',
  }

  function body(): ReactNode {
    switch (current.key) {
      case 'interface':
        // Режим интерфейса (решение 80): выбор каждого человека, хранится в его браузере.
        return (
          <Row
            title="Режим интерфейса"
            caption="Рабочий — реестры списком и сразу видно, что горит. Презентационный — весь визуал для показа."
            hint="Выбор запоминается в этом браузере: на другом устройстве его нужно сделать заново."
          >
            <UiModeSwitch />
          </Row>
        )

      case 'market':
        if (!canSeeSources) return <Locked what="Источники данных" />
        if (integrations.isLoading) return <RowsSkeleton count={2} />
        if (integrations.error) return <ErrorState error={integrations.error} onRetry={integrations.reload} />
        if (!integrations.data) return null
        return (
          <>
            <Row
              title="Активный источник"
              caption={PROVIDER_LABELS[integrations.data.marketDataProvider] ?? integrations.data.marketDataProvider}
            >
              {canSync ? (
                <Button icon="refresh" onClick={onSync} isLoading={sync.isPending} variant="secondary" size="sm">
                  Синхронизировать
                </Button>
              ) : (
                <span className={styles.muted}>Запускает администратор, менеджер или аналитик</span>
              )}
            </Row>
            <Row title="Состояние проверено" caption={formatDateTime(integrations.data.checkedAt)} />
          </>
        )

      case 'sources':
        if (!canSeeSources) return <Locked what="Источники данных" />
        if (sources.isLoading) return <RowsSkeleton count={3} />
        if (sources.error) return <ErrorState error={sources.error} onRetry={sources.reload} />
        if (!sources.data || sources.data.length === 0) {
          return (
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
          )
        }
        return (
          <div className={sources.isRefreshing ? styles.refreshing : undefined}>
            {sources.data.map((source) => (
              <SourceRow key={source.id} source={source} />
            ))}
          </div>
        )

      case 'integrations':
        if (!canSeeSources) return <Locked what="Интеграции" />
        if (integrations.isLoading) return <RowsSkeleton count={3} />
        if (integrations.error) return <ErrorState error={integrations.error} onRetry={integrations.reload} />
        if (!integrations.data) return null
        return (
          <>
            {integrations.data.integrations.map((item) => {
              const status = integrationStatus(item)
              return (
                <Row key={item.key} title={item.name} caption={item.reason ?? undefined}>
                  <Badge tone={status.tone} withDot>
                    {status.label}
                  </Badge>
                </Row>
              )
            })}
            {(() => {
              const ai = aiAssistRow(integrations.data.aiAssist)
              return (
                <Row
                  title="ИИ-помощник"
                  caption={ai.caption}
                  hint="Пишет черновики сводки по связке, письма вузу и дел на сегодня по фактам, которые посчитали правила. Провайдер задаётся переменной AI_ASSIST_PROVIDER; без модели тот же текст собирает шаблон."
                >
                  <Badge tone={ai.tone} withDot>
                    {ai.label}
                  </Badge>
                </Row>
              )
            })()}
            {/* Бот Telegram (решение 142) — подробный блок: токен, режим приёма, вебхук. */}
            {isAdmin && <TelegramBotAdminSection />}
            {/* Остальные каналы уведомлений (решение 144): MAX, VK — Telegram уже выше. */}
            {isAdmin ? <AdminChannelsSection /> : null}
          </>
        )

      case 'users':
        return isAdmin ? <UsersSection /> : null

      case 'audit':
        return isAdmin ? <AuditSection /> : null

      case 'about':
        return (
          <>
            <Row
              title="Версия"
              caption="Номер версии и сборки система не публикует — придумывать значение мы не стали."
            />
            <Row
              title="Демонстрационные данные"
              caption="Помечены значком и за подтверждённую статистику не выдаются."
            >
              <Badge tone="mock">Демонстрационные данные</Badge>
            </Row>
            {/* Не сырой JSON (решение 126): состояние — страницей в приложении,
                контракт — документом в репозитории, в новой вкладке. */}
            <Row title="Состояние системы" caption="Работает ли сервер, база и схема данных">
              <Link className={styles.link} href={ROUTES.status}>
                Открыть
                <Icon name="arrowRight" size={16} />
              </Link>
            </Row>
            <Row title="Контракт API" caption="Описание методов API — документ в репозитории">
              <a className={styles.link} href={API_CONTRACT_URL} target="_blank" rel="noreferrer">
                Открыть
                <Icon name="external" size={16} />
              </a>
            </Row>
          </>
        )
    }
  }

  return (
    <>
      <PageHeader title="Настройки" />

      <div className={[styles.layout, WIDE_SECTIONS.includes(current.key) ? styles.layoutWide : ''].filter(Boolean).join(' ')}>
        <nav className={styles.nav} aria-label="Разделы настроек">
          {sections.map((section) => (
            <a
              key={section.key}
              href={`#${section.key}`}
              className={styles.navItem}
              aria-current={section.key === current.key ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault()
                choose(section.key)
              }}
            >
              <Icon name={section.icon} size={16} />
              {section.label}
            </a>
          ))}
        </nav>

        <section
          className={[styles.panel, WIDE_SECTIONS.includes(current.key) ? styles.panelWide : ''].filter(Boolean).join(' ')}
          id={current.key}
          aria-labelledby="settings-section-title"
        >
          <h2 className={styles.panelTitle} id="settings-section-title">
            {current.label}
            {hints[current.key] && <Hint text={hints[current.key]!} />}
          </h2>
          <div className={styles.rows}>{body()}</div>
        </section>
      </div>
    </>
  )
}
