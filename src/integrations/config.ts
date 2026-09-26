import { isIP } from 'node:net'

/**
 * Настройки интеграций. Всё берётся из переменных окружения — в коде секретов нет.
 *
 * По умолчанию интеграции выключены: система должна работать без них,
 * а их сбой не должен ломать основной контур.
 */

function readBoolean(name: string, fallback = false): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  return raw === 'true' || raw === '1'
}

function readNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

function readString(name: string): string | null {
  const raw = process.env[name]
  return raw === undefined || raw.trim() === '' ? null : raw.trim()
}

/** Какой источник рыночных данных активен — переменная `MARKET_DATA_PROVIDER`. */
export const MARKET_DATA_PROVIDERS = ['mock', 'csv', 'external-api', 'future-rtk'] as const
export type MarketDataProviderKind = (typeof MARKET_DATA_PROVIDERS)[number]

function readProviderKind(): MarketDataProviderKind {
  const raw = readString('MARKET_DATA_PROVIDER') ?? 'mock'
  return (MARKET_DATA_PROVIDERS as readonly string[]).includes(raw)
    ? (raw as MarketDataProviderKind)
    : 'mock'
}

/**
 * Провайдер ИИ-помощника (решение 90). По умолчанию выключен: помощник отдаёт
 * шаблонный текст из фактов правил, модель не вызывается.
 */
export const AI_ASSIST_PROVIDERS = ['off', 'yandexgpt', 'gigachat'] as const
export type AiAssistProviderKind = (typeof AI_ASSIST_PROVIDERS)[number]

function readAiAssistProvider(): AiAssistProviderKind {
  const raw = readString('AI_ASSIST_PROVIDER') ?? 'off'
  return (AI_ASSIST_PROVIDERS as readonly string[]).includes(raw)
    ? (raw as AiAssistProviderKind)
    : 'off'
}

export interface AiAssistConfig {
  provider: AiAssistProviderKind
  /**
   * Свой таймаут, отдельно от INTEGRATION_TIMEOUT_MS: модель пишет текст секунды,
   * а не миллисекунды. Повторов нет — человек ждёт у кнопки, и шаблон лучше второй
   * попытки в полминуты.
   */
  timeoutMs: number
  yandexGpt: {
    apiKey: string | null
    folderId: string | null
    model: string
  }
  gigaChat: {
    authKey: string | null
    scope: string
    model: string
    /** Сертификат НУЦ Минцифры: без него TLS до GigaChat не проходит. */
    caCertPath: string | null
  }
}

/**
 * Как бот принимает обновления (решение 142): `webhook` — только вебхук,
 * `polling` — только long polling (`getUpdates`), `auto` — вебхук, пока он
 * отвечает, иначе сам процесс переключается на polling. Администратор может
 * задать режим и в админке — тогда запись в базе главнее переменной окружения
 * (`integrations/telegram/runtime-config.ts`).
 */
export const TELEGRAM_MODE_VALUES = ['webhook', 'polling', 'auto'] as const
export type TelegramMode = (typeof TELEGRAM_MODE_VALUES)[number]

function readTelegramMode(): TelegramMode {
  const raw = readString('TELEGRAM_MODE') ?? 'auto'
  return (TELEGRAM_MODE_VALUES as readonly string[]).includes(raw) ? (raw as TelegramMode) : 'auto'
}

/**
 * Бот личных уведомлений в Telegram (решение 102). Выключен, пока не задан токен:
 * блок в профиле пишет «Не настроено администратором», вебхук ничего не делает.
 */
export interface TelegramConfig {
  /** Токен от BotFather. Секрет: env или база (зашифрован, решение 142) — в журнал и в ответы не попадает. */
  botToken: string | null
  /** Имя бота без @ — для ссылки t.me/<имя>?start=<токен привязки>. */
  botUsername: string | null
  /** Значение заголовка X-Telegram-Bot-Api-Secret-Token, заданное в setWebhook. */
  webhookSecret: string | null
  /** База Bot API без завершающего слэша. */
  apiBase: string
  /**
   * IP, на который идёт соединение с Bot API, если имя из apiBase недоступно
   * (из Yandex Cloud — 149.154.167.220). SNI и Host остаются из apiBase.
   */
  apiIp: string | null
  timeoutMs: number
  /** Бот работает: есть и токен, и имя, и секрет вебхука. */
  enabled: boolean
  /** Режим приёма обновлений — из env, TELEGRAM_MODE (решение 142). */
  mode: TelegramMode
}

export const TELEGRAM_DEFAULT_API_BASE = 'https://api.telegram.org'

/** База Bot API: только http(s)-адрес, иначе — адрес по умолчанию. */
function readTelegramApiBase(): string {
  const raw = readString('TELEGRAM_API_BASE')
  if (!raw) return TELEGRAM_DEFAULT_API_BASE
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return TELEGRAM_DEFAULT_API_BASE
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  } catch {
    return TELEGRAM_DEFAULT_API_BASE
  }
}

/** Только IP: имя здесь теряет смысл — ради обхода DNS переменная и заведена. */
function readTelegramApiIp(): string | null {
  const raw = readString('TELEGRAM_API_IP')
  return raw && isIP(raw) !== 0 ? raw : null
}

function readTelegramConfig(timeoutMs: number): TelegramConfig {
  const botToken = readString('TELEGRAM_BOT_TOKEN')
  const botUsername = readString('TELEGRAM_BOT_USERNAME')?.replace(/^@/, '') ?? null
  const webhookSecret = readString('TELEGRAM_WEBHOOK_SECRET')
  return {
    botToken,
    botUsername,
    webhookSecret,
    apiBase: readTelegramApiBase(),
    apiIp: readTelegramApiIp(),
    timeoutMs,
    enabled: botToken !== null && botUsername !== null && webhookSecret !== null,
    mode: readTelegramMode(),
  }
}

/**
 * Бот уведомлений в MAX (мессенджер VK, решение 144). Как и Telegram — выключен,
 * пока не задан токен и имя бота: канал в блоке «Каналы уведомлений» пишет
 * «Не настроено администратором». Секрет вебхука — свой, MAX_WEBHOOK_SECRET:
 * в отличие от Telegram, платформа не выдаёт его сама при подписке (POST
 * /subscriptions передаёт secret, который задаёт сам оператор бота), поэтому
 * без него входящие обновления MAX не принимаются (403), а отправка работает.
 */
export interface MaxConfig {
  /** Токен бота MAX (создаётся в личном кабинете разработчика MAX). */
  botToken: string | null
  /** Имя бота без @ — для диплинка https://max.ru/<имя>/start/<код>. */
  botUsername: string | null
  /** Значение заголовка X-Max-Bot-Api-Secret, заданное при подписке на вебхук. */
  webhookSecret: string | null
  /** База Bot API MAX. */
  apiBase: string
  timeoutMs: number
  /** Можно отправлять сообщения: есть и токен, и имя бота. */
  enabled: boolean
}

export const MAX_DEFAULT_API_BASE = 'https://platform-api2.max.ru'

function readMaxConfig(timeoutMs: number): MaxConfig {
  const botToken = readString('MAX_BOT_TOKEN')
  const botUsername = readString('MAX_BOT_USERNAME')?.replace(/^@/, '') ?? null
  return {
    botToken,
    botUsername,
    webhookSecret: readString('MAX_WEBHOOK_SECRET'),
    apiBase: readString('MAX_API_BASE') ?? MAX_DEFAULT_API_BASE,
    timeoutMs,
    enabled: botToken !== null && botUsername !== null,
  }
}

/**
 * Бот сообщества VK (решение 144): рассылка через messages.send. Подлинность
 * входящих Callback API — код подтверждения (показывает VK при включении Callback
 * API) и секретная строка `secret` в теле каждого события (не заголовок, как у
 * Telegram и MAX, — так устроен Callback API VK).
 */
export interface VkConfig {
  /** Токен сообщества с правом messages (Управление сообществом → Работа с API). */
  groupToken: string | null
  /** id сообщества (число, без минуса) — для vk.me/public<id> и messages.send. */
  groupId: string | null
  /** Строка, которую VK Callback API ждёт в ответ на event type=confirmation. */
  confirmationCode: string | null
  /** Секрет из настроек Callback API — сверяется с полем `secret` каждого события. */
  secret: string | null
  apiBase: string
  /** Версия VK API (параметр v). */
  apiVersion: string
  timeoutMs: number
  /** Можно отправлять сообщения: есть и токен сообщества, и его id. */
  enabled: boolean
}

export const VK_DEFAULT_API_BASE = 'https://api.vk.com/method'
export const VK_DEFAULT_API_VERSION = '5.199'

function readVkConfig(timeoutMs: number): VkConfig {
  const groupToken = readString('VK_GROUP_TOKEN')
  const groupId = readString('VK_GROUP_ID')
  return {
    groupToken,
    groupId,
    confirmationCode: readString('VK_CONFIRMATION_CODE'),
    secret: readString('VK_SECRET'),
    apiBase: readString('VK_API_BASE') ?? VK_DEFAULT_API_BASE,
    apiVersion: readString('VK_API_VERSION') ?? VK_DEFAULT_API_VERSION,
    timeoutMs,
    enabled: groupToken !== null && groupId !== null,
  }
}

export interface IntegrationCommonConfig {
  timeoutMs: number
  retries: number
  /** Минимальный интервал между запросами к одному внешнему сервису, мс. */
  minIntervalMs: number
}

export interface RemoteServiceConfig {
  enabled: boolean
  baseUrl: string | null
  token: string | null
}

export interface IntegrationsConfig {
  common: IntegrationCommonConfig
  marketData: {
    kind: MarketDataProviderKind
    csvPath: string | null
    apiUrl: string | null
    apiToken: string | null
  }
  lms: RemoteServiceConfig
  site: RemoteServiceConfig
  aiAssist: AiAssistConfig
  telegram: TelegramConfig
  max: MaxConfig
  vk: VkConfig
}

/**
 * Читается при каждом обращении, а не один раз на импорт: так переменные окружения
 * можно поменять без пересборки, а тесты не зависят от порядка импортов.
 */
export function getIntegrationsConfig(): IntegrationsConfig {
  const common: IntegrationCommonConfig = {
    timeoutMs: readNumber('INTEGRATION_TIMEOUT_MS', 5000),
    retries: readNumber('INTEGRATION_RETRIES', 2),
    minIntervalMs: readNumber('INTEGRATION_MIN_INTERVAL_MS', 200),
  }
  return {
    common,
    marketData: {
      kind: readProviderKind(),
      csvPath: readString('MARKET_DATA_CSV_PATH'),
      apiUrl: readString('MARKET_DATA_API_URL'),
      apiToken: readString('MARKET_DATA_API_TOKEN'),
    },
    lms: {
      enabled: readBoolean('LMS_ENABLED'),
      baseUrl: readString('LMS_API_URL'),
      token: readString('LMS_API_TOKEN'),
    },
    site: {
      enabled: readBoolean('SITE_ENABLED'),
      baseUrl: readString('SITE_API_URL'),
      token: readString('SITE_API_TOKEN'),
    },
    aiAssist: {
      provider: readAiAssistProvider(),
      timeoutMs: readNumber('AI_ASSIST_TIMEOUT_MS', 15000),
      yandexGpt: {
        apiKey: readString('YANDEX_GPT_API_KEY'),
        folderId: readString('YANDEX_FOLDER_ID'),
        model: readString('YANDEX_GPT_MODEL') ?? 'yandexgpt-lite',
      },
      gigaChat: {
        authKey: readString('GIGACHAT_AUTH_KEY'),
        scope: readString('GIGACHAT_SCOPE') ?? 'GIGACHAT_API_PERS',
        model: readString('GIGACHAT_MODEL') ?? 'GigaChat',
        caCertPath: readString('GIGACHAT_CA_CERT_PATH'),
      },
    },
    telegram: readTelegramConfig(common.timeoutMs),
    max: readMaxConfig(common.timeoutMs),
    vk: readVkConfig(common.timeoutMs),
  }
}
